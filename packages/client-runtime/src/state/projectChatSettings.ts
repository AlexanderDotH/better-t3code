import {
  ProjectChatSettings,
  type EnvironmentId,
  type ScopedProjectRef,
  type ServerConfig,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import {
  projectChatSettingsSnapshot,
  type ResolvedProjectChatSettings,
} from "../projectChatSettings.ts";
import { parseProjectKey, projectKey } from "./entities.ts";
import {
  createAtomCommandScheduler,
  type AtomCommand,
  type AtomCommandScheduler,
} from "./runtime.ts";

const sameProjectChatSettings = Schema.toEquivalence(ProjectChatSettings);

interface PendingProjectChatSettings {
  readonly settings: ResolvedProjectChatSettings;
  cancelObservation?: () => void;
}

export function createProjectChatSettingsState<E>(input: {
  readonly configValueAtom: (environmentId: EnvironmentId) => Atom.Atom<ServerConfig | null>;
  readonly scheduler?: AtomCommandScheduler;
  readonly updateSettings: AtomCommand<
    {
      readonly environmentId: EnvironmentId;
      readonly input: { readonly patch: ServerSettingsPatch };
    },
    ServerSettings,
    E
  >;
}) {
  const scheduler = input.scheduler ?? createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: (target: ScopedProjectRef) => target.environmentId,
  };
  const pendingFamily = Atom.family((key: string) =>
    Atom.make<PendingProjectChatSettings | undefined>(undefined).pipe(
      Atom.keepAlive,
      Atom.withLabel(`environment-data:project-chat-settings:pending:${key}`),
    ),
  );
  const valueFamily = Atom.family((key: string) => {
    const target = parseProjectKey(key);
    return Atom.make((get): ProjectChatSettings | undefined => {
      const config = get(input.configValueAtom(target.environmentId));
      if (config?.environment.capabilities.projectChatSettings !== true) return undefined;
      return (
        get(pendingFamily(key))?.settings ?? config.settings.projectChatSettings[target.projectId]
      );
    }).pipe(Atom.withLabel(`environment-data:project-chat-settings:value:${key}`));
  });
  const projectChatSettingsValueAtom = (target: ScopedProjectRef) =>
    valueFamily(projectKey(target));
  const rememberProjectChatSettings: AtomCommand<
    ScopedProjectRef & { readonly settings: ResolvedProjectChatSettings },
    void,
    E
  > = {
    label: "environment-data:server:remember-project-chat-settings",
    run: async (registry, target) => {
      const source = input.configValueAtom(target.environmentId);
      if (registry.get(source)?.environment.capabilities.projectChatSettings !== true) {
        return AsyncResult.success(undefined);
      }
      const pendingAtom = pendingFamily(projectKey(target));
      registry.get(pendingAtom)?.cancelObservation?.();
      const pending: PendingProjectChatSettings = {
        settings: projectChatSettingsSnapshot(target.settings),
      };
      registry.set(pendingAtom, pending);
      const remove = () => {
        if (registry.get(pendingAtom) === pending) registry.set(pendingAtom, undefined);
        pending.cancelObservation?.();
      };
      let confirmed = false;
      try {
        let reconcile: ((config: ServerConfig | null) => void) | undefined;
        let acknowledged = false;
        const result = await scheduler.schedule(registry, concurrency, target, async () => {
          const initialConfig = registry.get(source);
          if (initialConfig?.environment.capabilities.projectChatSettings !== true) {
            remove();
            return AsyncResult.success(undefined);
          }
          const initialSettings = initialConfig.settings;
          let observed = false;
          reconcile = (config) => {
            const stored = config?.settings.projectChatSettings[target.projectId];
            // A coalesced stream can skip our value and already carry a later device's choice.
            observed ||=
              config?.settings !== initialSettings ||
              (stored !== undefined && sameProjectChatSettings(stored, pending.settings));
            if (
              config?.environment.capabilities.projectChatSettings !== true ||
              (acknowledged && observed)
            ) {
              remove();
            }
          };
          if (registry.get(pendingAtom) === pending) {
            pending.cancelObservation = registry.subscribe(source, reconcile);
            reconcile(registry.get(source));
          }
          const updated = await input.updateSettings.run(registry, {
            environmentId: target.environmentId,
            input: { patch: { projectChatSettings: { [target.projectId]: pending.settings } } },
          });
          return AsyncResult.isSuccess(updated)
            ? AsyncResult.success(undefined)
            : AsyncResult.failure(updated.cause);
        });
        if (!AsyncResult.isSuccess(result)) return AsyncResult.failure(result.cause);
        if (registry.get(pendingAtom) === pending) {
          acknowledged = true;
          reconcile?.(registry.get(source));
        }
        confirmed = true;
        return AsyncResult.success(undefined);
      } finally {
        if (!confirmed) remove();
      }
    },
  };
  return { projectChatSettingsValueAtom, rememberProjectChatSettings };
}
