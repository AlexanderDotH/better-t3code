import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ServerSettings,
  ThreadId,
  type ScopedProjectRef,
  type ServerConfig,
} from "@t3tools/contracts";
import { CODEX_CONTEXT_WINDOW_OPTION_ID } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveProjectChatSettings,
  type ProjectChatSettingsThread,
  type ResolvedProjectChatSettings,
} from "./projectChatSettings.ts";
import { createProjectChatSettingsState } from "./state/projectChatSettings.ts";

const LOCAL_PROJECT = {
  environmentId: EnvironmentId.make("local"),
  projectId: ProjectId.make("project-1"),
  name: "Same project name",
};
const REMOTE_PROJECT = {
  ...LOCAL_PROJECT,
  environmentId: EnvironmentId.make("remote"),
};
const OTHER_PROJECT = { ...LOCAL_PROJECT, projectId: ProjectId.make("project-2") };

const INITIAL_CHOICES: ResolvedProjectChatSettings = {
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "initial-model" },
  runtimeMode: "full-access",
  composerMode: "default",
};
const LAST_CHOICES: ResolvedProjectChatSettings = {
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "chosen-model",
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "priority" },
      { id: CODEX_CONTEXT_WINDOW_OPTION_ID, value: "1000000" },
      { id: "fastMode", value: false },
    ],
  },
  runtimeMode: "auto",
  composerMode: "deep-plan",
};

const INITIAL_SETTINGS: ServerSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  defaultModelSelection: INITIAL_CHOICES.modelSelection,
};

const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);

function restartFromSavedSettings(settings: ServerSettings): ServerSettings {
  const saved = JSON.stringify(encodeServerSettings(settings));
  return decodeServerSettings(JSON.parse(saved));
}

function resolveNewThreadChoices(
  settings: ServerSettings,
  target: ScopedProjectRef,
  threads: ReadonlyArray<ProjectChatSettingsThread> = [],
) {
  const defaults = resolveProjectSettings(settings, target.projectId).settings;
  return resolveProjectChatSettings({
    target,
    remembered: settings.projectChatSettings[target.projectId],
    threads,
    defaults: {
      modelSelection: defaults.defaultModelSelection ?? INITIAL_CHOICES.modelSelection,
      runtimeMode: defaults.defaultRuntimeMode,
      composerMode: "default",
    },
  });
}

describe("project chat settings acceptance", () => {
  it("restores complete choices for each project and environment, including cleared options", () => {
    const remoteChoices: ResolvedProjectChatSettings = {
      modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "remote-model" },
      runtimeMode: "approval-required",
      composerMode: "plan",
    };
    const otherChoices: ResolvedProjectChatSettings = {
      ...INITIAL_CHOICES,
      modelSelection: { ...INITIAL_CHOICES.modelSelection, model: "other-project-model" },
    };
    const localSettings = applyServerSettingsPatch(INITIAL_SETTINGS, {
      projectChatSettings: {
        [LOCAL_PROJECT.projectId]: LAST_CHOICES,
        [OTHER_PROJECT.projectId]: otherChoices,
      },
    });
    const remoteSettings = applyServerSettingsPatch(INITIAL_SETTINGS, {
      projectChatSettings: { [REMOTE_PROJECT.projectId]: remoteChoices },
    });
    const restartedLocal = restartFromSavedSettings(localSettings);
    const restartedRemote = restartFromSavedSettings(remoteSettings);

    expect(resolveNewThreadChoices(restartedLocal, LOCAL_PROJECT)).toEqual(LAST_CHOICES);
    expect(resolveNewThreadChoices(restartedRemote, REMOTE_PROJECT)).toEqual(remoteChoices);
    expect(resolveNewThreadChoices(restartedLocal, OTHER_PROJECT)).toEqual(otherChoices);

    const clearedChoices = {
      ...LAST_CHOICES,
      modelSelection: { ...LAST_CHOICES.modelSelection, options: [] },
    };
    const afterClearing = restartFromSavedSettings(
      applyServerSettingsPatch(restartedLocal, {
        projectChatSettings: { [LOCAL_PROJECT.projectId]: clearedChoices },
      }),
    );

    expect(resolveNewThreadChoices(afterClearing, LOCAL_PROJECT)).toEqual(clearedChoices);
    expect(resolveNewThreadChoices(afterClearing, OTHER_PROJECT)).toEqual(otherChoices);
    expect(resolveNewThreadChoices(restartedRemote, REMOTE_PROJECT)).toEqual(remoteChoices);
  });

  it("bootstraps from project usage without copying history, then honors changed and reset defaults", () => {
    const usedThread = {
      ...LOCAL_PROJECT,
      id: ThreadId.make("used-thread"),
      title: "Same project name",
      modelSelection: LAST_CHOICES.modelSelection,
      runtimeMode: LAST_CHOICES.runtimeMode,
      interactionMode: "plan",
      composerMode: LAST_CHOICES.composerMode,
      latestUserMessageAt: "2026-10-15T12:00:00.000Z",
      createdAt: "2026-10-10T12:00:00.000Z",
      updatedAt: "2026-10-15T12:01:00.000Z",
      branch: "existing-work",
      worktreePath: "/worktrees/existing-work",
      messages: [{ role: "user", text: "Existing history", attachments: ["existing.png"] }],
      context: [{ kind: "file", path: "existing.ts" }],
      session: { id: "existing-session", status: "ready" },
      deepPlanSourceRefs: [{ ...LOCAL_PROJECT, threadId: ThreadId.make("plan-source") }],
    } satisfies ProjectChatSettingsThread & Record<string, unknown>;
    const viewedOldThread = {
      ...usedThread,
      id: ThreadId.make("viewed-old-thread"),
      modelSelection: INITIAL_CHOICES.modelSelection,
      latestUserMessageAt: "2026-10-11T12:00:00.000Z",
      updatedAt: "2026-10-16T12:00:00.000Z",
    };
    const unrelatedThread = {
      ...usedThread,
      ...OTHER_PROJECT,
      latestUserMessageAt: "2026-10-16T12:00:00.000Z",
    };
    const remoteThreadWithSameId = {
      ...usedThread,
      ...REMOTE_PROJECT,
      modelSelection: INITIAL_CHOICES.modelSelection,
      latestUserMessageAt: "2026-10-16T12:00:00.000Z",
    };
    const unusedThread = { ...usedThread, id: ThreadId.make("unused"), latestUserMessageAt: null };
    const threads = [
      viewedOldThread,
      remoteThreadWithSameId,
      unrelatedThread,
      unusedThread,
      usedThread,
    ];
    const originalThreads = structuredClone(threads);
    const initial = resolveNewThreadChoices(INITIAL_SETTINGS, LOCAL_PROJECT, threads);

    expect(initial).toEqual(LAST_CHOICES);
    expect(Object.keys(initial).sort()).toEqual(["composerMode", "modelSelection", "runtimeMode"]);
    expect(threads).toEqual(originalThreads);

    const remembered = applyServerSettingsPatch(INITIAL_SETTINGS, {
      projectChatSettings: { [LOCAL_PROJECT.projectId]: initial },
    });
    const projectModel = { ...INITIAL_CHOICES.modelSelection, model: "project-default" };
    const changed = restartFromSavedSettings(
      applyServerSettingsPatch(remembered, {
        projectSettingsOverrides: {
          [LOCAL_PROJECT.projectId]: {
            defaultModelSelection: projectModel,
            defaultRuntimeMode: "approval-required",
          },
        },
      }),
    );
    expect(resolveNewThreadChoices(changed, LOCAL_PROJECT, threads)).toEqual({
      modelSelection: projectModel,
      runtimeMode: "approval-required",
      composerMode: "deep-plan",
    });

    const reset = restartFromSavedSettings(
      applyServerSettingsPatch(changed, {
        projectSettingsOverrides: { [LOCAL_PROJECT.projectId]: null },
      }),
    );
    expect(resolveNewThreadChoices(reset, LOCAL_PROJECT, threads)).toEqual({
      ...INITIAL_CHOICES,
      composerMode: "deep-plan",
    });

    const defaultsOnly = restartFromSavedSettings(
      applyServerSettingsPatch(reset, { projectChatSettings: { [LOCAL_PROJECT.projectId]: {} } }),
    );
    expect(defaultsOnly.projectChatSettings[LOCAL_PROJECT.projectId]).toEqual({});
    expect(resolveNewThreadChoices(defaultsOnly, LOCAL_PROJECT, threads)).toEqual(INITIAL_CHOICES);
    expect(threads).toEqual(originalThreads);
  });

  it("resolves a pending choice before acknowledgement and keeps it after restart", async () => {
    const registry = AtomRegistry.make();
    const acknowledged = Promise.withResolvers<void>();
    let savedSettings = INITIAL_SETTINGS;
    const initialConfig = {
      settings: INITIAL_SETTINGS,
      environment: { capabilities: { projectChatSettings: true } },
    } as ServerConfig;
    const configFamily = Atom.family((_environmentId: EnvironmentId) =>
      Atom.make<ServerConfig | null>(initialConfig),
    );
    const state = createProjectChatSettingsState({
      configValueAtom: configFamily,
      updateSettings: {
        label: "acceptance:update-settings",
        run: async (_registry, target) => {
          await acknowledged.promise;
          savedSettings = applyServerSettingsPatch(savedSettings, target.input.patch);
          return AsyncResult.success(savedSettings);
        },
      },
    });

    try {
      const pendingWrite = state.rememberProjectChatSettings.run(registry, {
        ...LOCAL_PROJECT,
        settings: LAST_CHOICES,
      });
      const pendingChoices = resolveProjectChatSettings({
        target: LOCAL_PROJECT,
        remembered: registry.get(state.projectChatSettingsValueAtom(LOCAL_PROJECT)),
        threads: [],
        defaults: INITIAL_CHOICES,
      });
      expect(pendingChoices).toEqual(LAST_CHOICES);
      expect(registry.get(state.projectChatSettingsValueAtom(REMOTE_PROJECT))).toBeUndefined();
      expect(registry.get(state.projectChatSettingsValueAtom(OTHER_PROJECT))).toBeUndefined();

      acknowledged.resolve();
      expect(AsyncResult.isSuccess(await pendingWrite)).toBe(true);
      expect(registry.get(state.projectChatSettingsValueAtom(LOCAL_PROJECT))).toEqual(LAST_CHOICES);

      const restarted = restartFromSavedSettings(savedSettings);
      registry.set(configFamily(LOCAL_PROJECT.environmentId), {
        ...initialConfig,
        settings: restarted,
      });
      expect(resolveNewThreadChoices(restarted, LOCAL_PROJECT)).toEqual(pendingChoices);
      expect(registry.get(state.projectChatSettingsValueAtom(LOCAL_PROJECT))).toEqual(
        pendingChoices,
      );
    } finally {
      acknowledged.resolve();
      registry.dispose();
    }
  });
});
