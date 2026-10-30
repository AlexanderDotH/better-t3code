import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  ComposerMode,
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ScopedProjectRef,
} from "@t3tools/contracts";
import type { ComposerThreadDraftState, DraftThreadEnvMode } from "../composerDraftStore";
import type { ResolvedProjectChatSettings } from "@t3tools/client-runtime/project-chat-settings";

type ComposerModelSelectionState = Pick<
  ComposerThreadDraftState,
  "activeProvider" | "modelSelectionByProvider" | "modelSelectionExplicit"
>;

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
    },
    // The opened draft's identity, which most callers have no use for.
  ): Promise<unknown>;
}

export interface ChatThreadActionContext {
  readonly activeDraftThread: ThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveNewDraftStartFromOrigin(input: {
  envMode: DraftThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}): boolean {
  return input.envMode === "worktree" && input.newWorktreesStartFromOrigin;
}

export function resolveNewThreadModelSelectionOverride(input: {
  readonly projectDefaultSelection: ModelSelection | null;
  readonly carrySelection: ModelSelection | null;
  readonly carrySourceDraftId: string | null;
  readonly destinationDraftId: string;
}): ModelSelection | null {
  return (
    input.projectDefaultSelection ??
    (input.carrySourceDraftId === input.destinationDraftId ? null : input.carrySelection)
  );
}

export function hasExplicitComposerModelSelection(
  draft: ComposerModelSelectionState | null | undefined,
): boolean {
  const activeProvider = draft?.activeProvider;
  return (
    draft?.modelSelectionExplicit === true &&
    activeProvider !== null &&
    activeProvider !== undefined &&
    draft.modelSelectionByProvider[activeProvider] !== undefined
  );
}

export function readComposerProjectChatSettings(input: {
  readonly draft: ComposerThreadDraftState | null;
  readonly fallback: ResolvedProjectChatSettings;
  readonly changes?: Partial<ResolvedProjectChatSettings>;
}): ResolvedProjectChatSettings {
  const activeProvider = input.draft?.activeProvider;
  const selection = activeProvider
    ? input.draft?.modelSelectionByProvider[activeProvider]
    : undefined;
  return {
    modelSelection: selection ?? input.fallback.modelSelection,
    runtimeMode: input.draft?.runtimeMode ?? input.fallback.runtimeMode,
    composerMode:
      input.draft?.composerMode ?? input.draft?.interactionMode ?? input.fallback.composerMode,
    ...input.changes,
  };
}

export function resolveAvailableComposerMode(input: {
  readonly mode: ComposerMode;
  readonly interactionModeEnabled: boolean;
  readonly deepPlanningSupported: boolean;
}): ComposerMode {
  if (input.mode === "chat") return "chat";
  if (input.mode === "deep-plan") {
    return input.deepPlanningSupported ? "deep-plan" : "default";
  }
  return input.mode === "plan" && input.interactionModeEnabled ? "plan" : "default";
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

// New threads inherit only the *project* from the current context. Branch,
// worktree, and env mode always come from the user's configured defaults —
// carrying them over from the viewed thread meant "new thread" silently
// reused checkouts and branches. Explicit affordances (branch toolbar's
// "new thread in this worktree") pass those options to handleNewThread
// directly instead.
export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef);
  return true;
}
