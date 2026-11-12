import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { chooseLoadBalancedEnvironment } from "@t3tools/client-runtime/load-balancing";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  AuthDiagnosticsReadScope,
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ModelSelection,
  type ServerConfig,
  sessionGrantsScope,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect } from "react";

import { mobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { loadBalancingProjects } from "./load-balancing";

const resourcesAtom = Atom.family((ids: string) =>
  Atom.make((get) => {
    const evaluatedAt = Date.now();
    const resources = ids
      .split("\n")
      .filter(Boolean)
      .map((id) => {
        const environmentId = id as EnvironmentId;
        const sessionResult = get(environmentSession.sessionStateAtom(environmentId));
        const session = AsyncResult.getOrElse(sessionResult, () => null);
        if (
          sessionResult._tag === "Failure" ||
          !session ||
          !sessionGrantsScope(session, AuthDiagnosticsReadScope) ||
          !sessionGrantsScope(session, AuthOrchestrationOperateScope)
        ) {
          return { environmentId, resources: null, receivedAt: 0, pending: false };
        }
        const result = get(serverEnvironment.hostResources({ environmentId, input: {} }));
        return {
          environmentId,
          resources: result._tag === "Success" ? result.value : null,
          receivedAt: result._tag === "Success" ? result.timestamp : 0,
          pending: result._tag === "Initial" || result.waiting,
        };
      });
    return { evaluatedAt, resources };
  }),
);

export function useLoadBalancedDraftProject(input: {
  readonly active: boolean;
  readonly draftKey: string | null;
  readonly resolvedDraftKey: string | null;
  readonly selectedProject: EnvironmentProject | null;
  readonly model: ModelSelection | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly configs: ReadonlyMap<EnvironmentId, ServerConfig>;
  readonly connections: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly connectionState: EnvironmentConnectionPhase;
  }>;
  readonly onSelect: (project: EnvironmentProject) => void;
}) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const enabled =
    AsyncResult.isSuccess(preferences) && preferences.value.loadBalancingEnabled === true;
  const weights = AsyncResult.isSuccess(preferences)
    ? (preferences.value.loadBalancingWeights ?? {})
    : {};
  const candidates =
    input.active && enabled && input.draftKey !== null && input.resolvedDraftKey !== input.draftKey
      ? loadBalancingProjects({
          ...input,
          connectedIds: new Set(
            input.connections
              .filter((connection) => connection.connectionState === "connected")
              .map((connection) => connection.environmentId),
          ),
          weights,
        })
      : [];
  const ids = [...new Set(candidates.map((project) => project.environmentId))];
  const snapshot = useAtomValue(resourcesAtom(ids.join("\n")));
  const pending = snapshot.resources.some((resource) => resource.pending);
  const selected = chooseLoadBalancedEnvironment(
    snapshot.resources.map((resource) => ({
      ...resource,
      weight: weights[resource.environmentId] ?? 50,
    })),
    snapshot.evaluatedAt,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists the environment chosen from asynchronous host resource responses into the draft store once
  useEffect(() => {
    if (
      !input.active ||
      !enabled ||
      pending ||
      !input.draftKey ||
      input.resolvedDraftKey === input.draftKey
    )
      return;
    const project = candidates.find((candidate) => candidate.environmentId === selected);
    if (!project) return;
    input.onSelect(project);
  }, [input, enabled, pending, selected, candidates]);
}
