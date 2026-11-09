import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  getProviderInteractionMode,
  resolveComposerMode,
} from "@t3tools/client-runtime/deep-planning";
import {
  executeAtomQuery,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { forkBoundaryKey, resolveForkWorkspaceSpec } from "@t3tools/client-runtime/thread-fork";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  T3_PROJECT_FILE_NAME,
  ThreadId,
  type EnvironmentId,
  type T3ProjectFile,
  type ThreadForkBoundary,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentProjects, projectEnvironment } from "../../state/projects";
import { useEnvironmentScope } from "../../state/session";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { getComposerDraftSnapshot } from "../../state/use-composer-drafts";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";
import { vcsEnvironment } from "../../state/vcs";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { waitForThreadShellReady } from "./threadForkNavigation";

export interface ThreadForkAction {
  readonly disabled: boolean;
  readonly pendingBoundaryKey: string | null;
  readonly onFork: (boundary: ThreadForkBoundary) => void;
}

async function readProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<T3ProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    projectEnvironment.readFile({
      environmentId,
      input: { cwd: workspaceRoot, relativePath: T3_PROJECT_FILE_NAME, allowMissing: true },
    }),
    { reportDefect: false, reportFailure: false },
  );
  if (result._tag !== "Success") return null;
  const data = result.value;
  if (data.exists === false || data.truncated) return null;
  return parseT3ProjectFile(data.contents);
}

/** Better T3's fork at a message or plan boundary, into the project's default workspace. */
export function useThreadForkAction(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): ThreadForkAction | null {
  const translator = useMobileInterfaceTranslator();
  const runtime = useRemoteEnvironmentRuntime(input.environmentId);
  const supported = runtime?.serverConfig?.environment.capabilities.threadForking === true;
  const canOperate = useEnvironmentScope(
    supported ? input.environmentId : null,
    AuthOrchestrationOperateScope,
  );
  const fork = useAtomCommand(threadEnvironment.fork, { reportFailure: false });
  const readStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const selectDetail = useSelectWorkspaceDetail();
  const pendingRef = useRef(false);
  const [pendingBoundaryKey, setPendingBoundaryKey] = useState<string | null>(null);
  if (!supported || !canOperate) return null;

  const forkAt = async (boundary: ThreadForkBoundary) => {
    const { environmentId } = input;
    const thread = appAtomRegistry.get(
      environmentThreadShells.threadShellAtom(scopeThreadRef(environmentId, input.threadId)),
    );
    if (thread === null) throw new Error(translator.message("mobile.thread.forkUnavailable"));
    const project = appAtomRegistry.get(
      environmentProjects.projectAtom(scopeProjectRef(environmentId, thread.projectId)),
    );
    if (project === null || project.workspaceRoot === "")
      throw new Error(translator.message("mobile.thread.forkProjectUnavailable"));
    const serverSettings = runtime?.serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
    const environmentTier = resolveProjectSettings(serverSettings, project.id, project).settings;
    const projectFile =
      environmentTier.defaultThreadEnvMode === null
        ? await readProjectFile(environmentId, project.workspaceRoot)
        : null;
    const settings = resolveProjectSettings(
      serverSettings,
      project.id,
      project,
      projectFile,
    ).settings;
    const status = await readStatus({ environmentId, input: { cwd: project.workspaceRoot } });
    if (status._tag === "Failure") throw squashAtomCommandFailure(status);
    const workspace = resolveForkWorkspaceSpec({
      defaultMode: settings.defaultThreadEnvMode,
      isGitRepository: status.value.isRepo,
      projectRootBranch: status.value.refName,
      newWorktreesStartFromOrigin: settings.newWorktreesStartFromOrigin,
    });
    if (workspace.mode === "worktree" && workspace.baseBranch === null)
      throw new Error(translator.message("mobile.thread.forkBaseBranchPending"));
    const draft = getComposerDraftSnapshot(scopedThreadKey(environmentId, thread.id));
    const targetThreadId = ThreadId.make(uuidv4());
    const result = await fork({
      environmentId,
      input: {
        threadId: targetThreadId,
        sourceThreadId: thread.id,
        boundary,
        modelSelection: draft.modelSelection ?? thread.modelSelection,
        runtimeMode: draft.runtimeMode ?? thread.runtimeMode,
        interactionMode: getProviderInteractionMode(
          resolveComposerMode(draft.composerMode, draft.interactionMode ?? thread.interactionMode),
        ),
        workspace,
        creationSource: "mobile",
        createdAt: new Date().toISOString(),
      },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      throw squashAtomCommandFailure(result);
    }
    void Haptics.selectionAsync().catch(() => undefined);
    const targetAtom = environmentThreadShells.threadShellAtom(
      scopeThreadRef(environmentId, targetThreadId),
    );
    if (
      !(await waitForThreadShellReady({ read: () => appAtomRegistry.get(targetAtom) !== null }))
    ) {
      Dialog.alert(
        translator.message("mobile.thread.forkCreated"),
        translator.message("mobile.thread.forkNotSynced"),
      );
      return;
    }
    selectDetail({ name: "Thread", params: { environmentId, threadId: targetThreadId } });
  };

  return {
    disabled: runtime?.connectionState !== "connected" || pendingBoundaryKey !== null,
    pendingBoundaryKey,
    onFork: (boundary) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPendingBoundaryKey(forkBoundaryKey(boundary));
      void forkAt(boundary)
        .catch((error: unknown) => {
          Dialog.alert(
            translator.message("mobile.thread.forkFailed"),
            error instanceof Error
              ? error.message
              : translator.message("mobile.thread.forkFailedDetail"),
          );
        })
        .finally(() => {
          pendingRef.current = false;
          setPendingBoundaryKey(null);
        });
    },
  };
}
