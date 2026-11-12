import { useAtomValue } from "@effect/atom-react";
import {
  applyProjectIndexActivityEvent,
  deriveProjectIndexChatStatus,
  projectIndexingSupported,
} from "@t3tools/client-runtime/project-indexing";
import { createEnvironmentRpcSubscriptionAtomFamily } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationReadScope,
  WS_METHODS,
  type ProjectIndexActivityV1,
} from "@t3tools/contracts";
import { Atom, AsyncResult } from "effect/reactivity";
import * as Stream from "effect/Stream";
import { useMemo } from "react";
import { SymbolView } from "../../components/ui/AppSymbol";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { connectedEnvironmentIdsAtom } from "../../state/presentation";
import { environmentSession, sessionHasScope } from "../../state/session";
import { environmentServerConfigsAtom } from "../../state/server";

const activityByEnvironment = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "mobile:home:project-index-activity",
  tag: WS_METHODS.projectIndexSubscribeActivity,
  idleTtlMs: 0,
  transform: (stream) =>
    stream.pipe(
      Stream.scan(
        () =>
          new Map<string, ProjectIndexActivityV1>() as ReadonlyMap<string, ProjectIndexActivityV1>,
        applyProjectIndexActivityEvent,
      ),
    ),
});

export function ProjectIndexingIndicator(props: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
}) {
  const translator = useMobileInterfaceTranslator();
  const activeAtom = useMemo(
    () =>
      Atom.make((get) => {
        const configs = get(environmentServerConfigsAtom);
        const connected = new Set(get(connectedEnvironmentIdsAtom));
        for (const environmentId of new Set(
          props.projects.map((project) => project.environmentId),
        )) {
          if (
            !connected.has(environmentId) ||
            !projectIndexingSupported(configs.get(environmentId)?.environment.capabilities) ||
            !sessionHasScope(
              get(environmentSession.sessionStateAtom(environmentId)),
              AuthOrchestrationReadScope,
            )
          )
            continue;
          const result = get(activityByEnvironment({ environmentId, input: {} }));
          if (!AsyncResult.isSuccess(result)) continue;
          for (const activity of result.value.values()) {
            if (
              !props.projects.some(
                (project) =>
                  project.environmentId === environmentId &&
                  project.id === activity.scope.projectId,
              )
            )
              continue;
            if (
              [
                "queued",
                "discovering",
                "extracting",
                "analyzing",
                "updating",
                "waiting-for-provider",
                "waiting-for-resources",
              ].includes(activity.state) &&
              deriveProjectIndexChatStatus(activity) !== null
            )
              return true;
          }
        }
        return false;
      }),
    [props.projects],
  );
  const active = useAtomValue(activeAtom);
  return active ? (
    <SymbolView
      accessibilityLabel={translator.message("mobile.home.indexing")}
      name="point.3.connected.trianglepath.dotted"
      size={15}
      tintColorClassName="accent-primary"
    />
  ) : null;
}
