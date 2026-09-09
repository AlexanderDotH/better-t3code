import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { resolveForkWorkspaceSpec } from "@t3tools/client-runtime/thread-fork";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ServerSettings,
  ThreadForkBoundary,
} from "@t3tools/contracts";
import { resolveDefaultThreadEnvMode } from "@t3tools/shared/threadEnvMode";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { waitForStartedServerThread } from "../components/ChatView.logic";
import { readT3ProjectFileDefaultThreadEnvMode } from "../lib/t3ProjectFileDefaults";
import { newThreadId } from "../lib/utils";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import type { Project, Thread } from "../types";

export function useThreadFork(input: {
  readonly thread: Thread | null;
  readonly project: Project | null;
  readonly available: boolean;
  readonly settings: Pick<ServerSettings, "defaultThreadEnvMode" | "newWorktreesStartFromOrigin">;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly getModelSelection: () => ModelSelection | undefined;
  readonly onError: (threadId: Thread["id"], message: string | null) => void;
  readonly onReady: () => void;
}) {
  const navigate = useNavigate();
  const fork = useAtomCommand(threadEnvironment.fork, { reportFailure: false });
  const readStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const inputRef = useRef(input);
  useLayoutEffect(() => {
    inputRef.current = input;
  });
  const pendingRef = useRef(false);
  const [pendingBoundary, setPendingBoundary] = useState<ThreadForkBoundary | null>(null);
  const onFork = useCallback(
    async (boundary: ThreadForkBoundary) => {
      const input = inputRef.current;
      const { thread, project } = input;
      if (!input.available || !thread || !project || pendingRef.current) return;
      pendingRef.current = true;
      setPendingBoundary(boundary);
      input.onError(thread.id, null);
      try {
        const projectFile =
          project.defaultThreadEnvMode == null
            ? await readT3ProjectFileDefaultThreadEnvMode(
                project.environmentId,
                project.workspaceRoot,
              )
            : null;
        const defaultMode = resolveDefaultThreadEnvMode({
          projectSetting: project.defaultThreadEnvMode,
          projectFile,
          globalDefault: input.settings.defaultThreadEnvMode,
        });
        const status = await readStatus({
          environmentId: project.environmentId,
          input: { cwd: project.workspaceRoot },
        });
        if (status._tag === "Failure") throw squashAtomCommandFailure(status);
        const workspace = resolveForkWorkspaceSpec({
          defaultMode,
          isGitRepository: status.value.isRepo,
          projectRootBranch: status.value.refName,
          newWorktreesStartFromOrigin: input.settings.newWorktreesStartFromOrigin,
        });
        if (workspace.mode === "worktree" && workspace.baseBranch === null)
          throw new Error("Wait for the project's base branch before forking into a new worktree.");
        const threadId = newThreadId();
        const result = await fork({
          environmentId: thread.environmentId,
          input: {
            threadId,
            sourceThreadId: thread.id,
            boundary,
            modelSelection: input.getModelSelection() ?? thread.modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            workspace,
            createdAt: new Date().toISOString(),
          },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) throw squashAtomCommandFailure(result);
          return;
        }
        await waitForStartedServerThread(scopeThreadRef(thread.environmentId, threadId));
        await navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: thread.environmentId, threadId },
        });
        input.onReady();
      } catch (error) {
        input.onError(
          thread.id,
          error instanceof Error ? error.message : "Could not fork this chat.",
        );
      } finally {
        pendingRef.current = false;
        setPendingBoundary(null);
      }
    },
    [fork, navigate, readStatus],
  );
  return { pendingBoundary, onFork };
}
