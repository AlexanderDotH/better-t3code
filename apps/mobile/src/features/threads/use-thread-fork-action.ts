import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ProjectReadFileResult,
  ServerConfig,
  T3_PROJECT_FILE_NAME,
  ThreadForkBoundary,
  ThreadId,
} from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import { isDefaultThreadEnvModeSettled } from "@t3tools/shared/threadEnvMode";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";

import { uuidv4 } from "../../lib/uuid";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useBranches } from "../../state/queries";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { forkBoundaryKey, resolveForkWorkspace } from "./thread-fork";

export function useThreadForkAction(input: {
  readonly thread: EnvironmentThreadShell | null;
  readonly project: EnvironmentProject | null;
  readonly serverConfig: ServerConfig | null;
  readonly supported: boolean;
  readonly connected: boolean;
  readonly onForked: (threadId: ThreadId) => void;
}) {
  const forkThread = useAtomCommand(threadEnvironment.fork, { reportFailure: false });
  const [pendingBoundaryKey, setPendingBoundaryKey] = useState<string | null>(null);
  const projectFileQuery = useEnvironmentQuery(
    input.supported && input.project !== null && input.project.workspaceRoot !== ""
      ? projectEnvironment.readFile({
          environmentId: input.project.environmentId,
          input: {
            cwd: input.project.workspaceRoot,
            relativePath: T3_PROJECT_FILE_NAME,
          },
        })
      : null,
  );
  const projectFileData = projectFileQuery.data as ProjectReadFileResult | null;
  const projectFileDefault = useMemo(() => {
    if (projectFileData === null || projectFileData.truncated) return null;
    return parseT3ProjectFile(projectFileData.contents)?.defaultThreadEnvMode ?? null;
  }, [projectFileData]);
  const branchState = useBranches({
    environmentId: input.supported ? (input.project?.environmentId ?? null) : null,
    cwd: input.supported ? input.project?.workspaceRoot || null : null,
  });
  const workspace = resolveForkWorkspace({
    projectSetting: input.project?.defaultThreadEnvMode,
    projectFile: projectFileDefault,
    globalDefault: input.serverConfig?.settings.defaultThreadEnvMode ?? "local",
    startFromOrigin: input.serverConfig?.settings.newWorktreesStartFromOrigin ?? true,
    refs: branchState.data?.refs ?? [],
  });
  const defaultsSettled = isDefaultThreadEnvModeSettled({
    explicitMode: undefined,
    projectSetting: input.project?.defaultThreadEnvMode,
    projectFilePending: projectFileQuery.isPending,
  });
  const enabled =
    input.supported &&
    input.connected &&
    input.thread !== null &&
    input.project !== null &&
    defaultsSettled &&
    (workspace.mode === "local" || workspace.baseBranch !== null);

  const onFork = useCallback(
    async (boundary: ThreadForkBoundary) => {
      if (!enabled || pendingBoundaryKey !== null || input.thread === null) return;

      const boundaryKey = forkBoundaryKey(boundary);
      const destinationThreadId = ThreadId.make(uuidv4());
      setPendingBoundaryKey(boundaryKey);
      try {
        const result = await forkThread({
          environmentId: input.thread.environmentId,
          input: {
            threadId: destinationThreadId,
            sourceThreadId: input.thread.id,
            boundary,
            modelSelection: input.thread.modelSelection,
            runtimeMode: input.thread.runtimeMode,
            interactionMode: input.thread.interactionMode,
            workspace,
          },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            Alert.alert(
              "Could not fork chat",
              error instanceof Error ? error.message : "The chat could not be forked.",
            );
          }
          return;
        }
        void Haptics.selectionAsync().catch(() => undefined);
        input.onForked(destinationThreadId);
      } finally {
        setPendingBoundaryKey(null);
      }
    },
    [enabled, forkThread, input, pendingBoundaryKey, workspace],
  );

  return {
    enabled,
    onFork,
    pendingBoundaryKey,
    supported: input.supported,
  } as const;
}
