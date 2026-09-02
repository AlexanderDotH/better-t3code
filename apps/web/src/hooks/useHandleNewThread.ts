import { useAtomValue } from "@effect/atom-react";
import {
  scopedProjectKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { DEFAULT_RUNTIME_MODE, type ScopedProjectRef, type ThreadId } from "@t3tools/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import {
  composerDraftHasUserContent,
  markPromotedDraftThreadByRef,
  type DraftId,
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import {
  deriveLogicalProjectKeyFromSettings,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { resolveDefaultThreadEnvMode } from "@t3tools/shared/threadEnvMode";
import { readThreadShell, useProjects, useThread } from "../state/entities";
import {
  resolveNewDraftStartFromOrigin,
  resolveNewThreadModelSelectionOverride,
} from "../lib/chatThreadActions";
import { readT3ProjectFileDefaultThreadEnvMode } from "../lib/t3ProjectFileDefaults";
import { primaryServerSettingsAtom } from "../state/server";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import { useClientSettings } from "./useSettings";
import { toastManager } from "../components/ui/toast";

interface NewThreadWorkspaceOptions {
  branch?: string | null;
  worktreePath?: string | null;
  envMode?: DraftThreadEnvMode;
  startFromOrigin?: boolean;
}

type NewThreadOpenResult = { draftId: DraftId; threadId: ThreadId } | null;

// Sidebar, command-palette, and keybinding surfaces mount their own hook
// instances against the same router. Sharing the in-flight registry at the
// router boundary makes a rapid cross-surface double invocation one action.
const inFlightNewThreadsByRouter = new WeakMap<object, Map<string, Promise<NewThreadOpenResult>>>();

// The workspace options the caller passed explicitly, shaped for the draft
// store: absent keys stay absent so they never overwrite existing draft
// state. Every reuse path applies exactly this set.
function pickExplicitWorkspaceOptions(options: NewThreadWorkspaceOptions | undefined) {
  return {
    ...(options?.branch !== undefined ? { branch: options.branch } : {}),
    ...(options?.worktreePath !== undefined ? { worktreePath: options.worktreePath } : {}),
    ...(options?.envMode !== undefined ? { envMode: options.envMode } : {}),
    ...(options?.startFromOrigin !== undefined ? { startFromOrigin: options.startFromOrigin } : {}),
  };
}

export function useNewThreadHandler() {
  const projects = useProjects();
  // New-thread defaults are a user preference, and the settings UI only ever
  // edits the primary environment's settings.json. Reading the target
  // environment's own settings here would silently reset remote projects to
  // the decoded defaults ("local" mode, current branch), since nothing can
  // set those values on a remote server.
  const primaryServerSettings = useAtomValue(primaryServerSettingsAtom);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const router = useRouter();
  const inFlightNewThreadByLogicalProjectKey = useMemo(() => {
    const existing = inFlightNewThreadsByRouter.get(router);
    if (existing) return existing;
    const created = new Map<string, Promise<NewThreadOpenResult>>();
    inFlightNewThreadsByRouter.set(router, created);
    return created;
  }, [router]);
  const getCurrentRouteTarget = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteTarget(currentRouteParams);
  }, [router]);

  return useCallback(
    (
      projectRef: ScopedProjectRef,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
        startFromOrigin?: boolean;
        replace?: boolean;
        /**
         * Move the viewed draft's typed content and transferable attachments into the
         * draft this request lands on. Set by the draft repo picker: the
         * user started writing in the wrong project and the text should
         * follow them. Explicit new-thread surfaces leave this unset and
         * keep mint-fresh semantics.
         */
        carryComposerContent?: boolean;
      },
      // Which draft the thread ended up in, so a caller that has something to put in it — a
      // prepared checkout, a task to write — addresses that one rather than looking the project
      // up again and finding whichever draft it happens to hold.
    ): Promise<NewThreadOpenResult> => {
      const {
        getComposerDraft,
        getDraftSessionByLogicalProjectKey,
        getDraftSession,
        getDraftThread,
        applyStickyState,
        moveComposerPromptAndImages,
        setDraftThreadContext,
        setLogicalProjectDraftThreadId,
        setModelSelection,
      } = useComposerDraftStore.getState();
      const currentRouteTarget = getCurrentRouteTarget();
      // A new thread carries the user's working mode from the thread being
      // viewed. The target project's configured model still wins; runtime and
      // interaction modes carry independently. Branch, worktree, and env mode
      // come from configured defaults unless the caller passes them explicitly.
      const carrySourceShell =
        currentRouteTarget?.kind === "server"
          ? readThreadShell(currentRouteTarget.threadRef)
          : null;
      const carrySourceDraft =
        currentRouteTarget?.kind === "draft" ? getDraftSession(currentRouteTarget.draftId) : null;
      // Composer overrides win over the persisted thread state — they are
      // what the user currently sees in the composer controls.
      const carrySourceComposer = currentRouteTarget
        ? getComposerDraft(
            currentRouteTarget.kind === "server"
              ? currentRouteTarget.threadRef
              : currentRouteTarget.draftId,
          )
        : null;
      const composerActiveProvider = carrySourceComposer?.activeProvider ?? null;
      const composerModelSelection = composerActiveProvider
        ? (carrySourceComposer?.modelSelectionByProvider[composerActiveProvider] ?? null)
        : null;
      const carryModelSelection =
        composerModelSelection ?? carrySourceShell?.modelSelection ?? null;
      const carryRuntimeMode =
        carrySourceComposer?.runtimeMode ??
        carrySourceShell?.runtimeMode ??
        carrySourceDraft?.runtimeMode ??
        null;
      const carryInteractionMode =
        carrySourceComposer?.interactionMode ??
        carrySourceShell?.interactionMode ??
        carrySourceDraft?.interactionMode ??
        null;
      // Content only moves when the caller opted in and the user is looking
      // at a draft. The content check happens at move time, not here: the
      // paths below await, and text typed during those awaits must still
      // come along.
      const carryContentSourceDraftId =
        options?.carryComposerContent === true && currentRouteTarget?.kind === "draft"
          ? currentRouteTarget.draftId
          : null;
      const carryComposerContentTo = (destinationDraftId: DraftId) => {
        if (
          carryContentSourceDraftId &&
          carryContentSourceDraftId !== destinationDraftId &&
          // Never clobber a destination the user already invested in — the
          // move overwrites the destination prompt, so a concurrent repo
          // change that carried content first must win.
          !composerDraftHasUserContent(getComposerDraft(destinationDraftId)) &&
          composerDraftHasUserContent(getComposerDraft(carryContentSourceDraftId))
        ) {
          moveComposerPromptAndImages(carryContentSourceDraftId, destinationDraftId);
          // The move caps at the destination's free slots and skips
          // duplicates, so images and files can both stay behind.
          const remainingDraft = getComposerDraft(carryContentSourceDraftId);
          const remainingCount =
            (remainingDraft?.files.length ?? 0) + (remainingDraft?.images.length ?? 0);
          if (remainingCount > 0) {
            toastManager.add({
              type: "warning",
              title: `${remainingCount} attachment${remainingCount === 1 ? " stayed" : "s stayed"} in the original draft`,
              description: "Return to the original draft or attach the files again.",
            });
          }
        }
      };
      const project = projects.find(
        (candidate) =>
          candidate.id === projectRef.projectId &&
          candidate.environmentId === projectRef.environmentId,
      );
      const resolveModelSelectionOverride = (destinationDraftId: DraftId) =>
        resolveNewThreadModelSelectionOverride({
          projectDefaultSelection: project?.defaultModelSelection ?? null,
          carrySelection: carryModelSelection,
          carrySourceDraftId:
            currentRouteTarget?.kind === "draft" ? currentRouteTarget.draftId : null,
          destinationDraftId,
        });
      // A project setting is already authoritative. Otherwise the global
      // setting is a safe provisional value while the optional checked-in
      // t3.json default is fetched in the background.
      const immediateDefaultEnvMode = resolveDefaultThreadEnvMode({
        projectSetting: project?.defaultThreadEnvMode,
        projectFile: null,
        globalDefault: primaryServerSettings.defaultThreadEnvMode,
      });
      const logicalProjectKey = project
        ? deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings)
        : scopedProjectKey(projectRef);
      const inFlightNewThread = inFlightNewThreadByLogicalProjectKey.get(logicalProjectKey);
      if (inFlightNewThread) {
        return inFlightNewThread;
      }
      const runDeduped = (open: () => Promise<NewThreadOpenResult>) => {
        const operation = open();
        inFlightNewThreadByLogicalProjectKey.set(logicalProjectKey, operation);
        const clearIfCurrent = () => {
          if (inFlightNewThreadByLogicalProjectKey.get(logicalProjectKey) === operation) {
            inFlightNewThreadByLogicalProjectKey.delete(logicalProjectKey);
          }
        };
        operation.then(clearIfCurrent, clearIfCurrent);
        return operation;
      };
      const refineDefaultEnvModeAfterProjectFileRead = (
        draftId: DraftId,
        expectedDraftThread: DraftThreadState | null,
      ) => {
        if (!project || project.defaultThreadEnvMode != null || !expectedDraftThread) {
          return;
        }
        const expectedComposerDraft = getComposerDraft(draftId);
        const expectedThreadRef = scopeThreadRef(
          expectedDraftThread.environmentId,
          expectedDraftThread.threadId,
        );
        // Navigation is deliberately started before this function is called.
        // A late file result is advisory and may only refine the exact,
        // untouched provisional draft that initiated the read.
        void readT3ProjectFileDefaultThreadEnvMode(
          project.environmentId,
          project.workspaceRoot,
        ).then(
          (projectFileDefault) => {
            const resolvedEnvMode = resolveDefaultThreadEnvMode({
              projectSetting: project.defaultThreadEnvMode,
              projectFile: projectFileDefault,
              globalDefault: primaryServerSettings.defaultThreadEnvMode,
            });
            const resolvedStartFromOrigin = resolveNewDraftStartFromOrigin({
              envMode: resolvedEnvMode,
              newWorktreesStartFromOrigin: primaryServerSettings.newWorktreesStartFromOrigin,
            });
            if (
              resolvedEnvMode === expectedDraftThread.envMode &&
              resolvedStartFromOrigin === expectedDraftThread.startFromOrigin
            ) {
              return;
            }
            const storeNow = useComposerDraftStore.getState();
            const draftThreadNow = storeNow.getDraftSession(draftId);
            if (
              // Object identity makes this an exact unchanged-since-registration
              // check, including branch/worktree and explicit composer picks.
              draftThreadNow === null ||
              draftThreadNow !== expectedDraftThread ||
              draftThreadNow.promotedTo != null ||
              storeNow.getDraftSessionByLogicalProjectKey(logicalProjectKey)?.draftId !== draftId ||
              readThreadShell(expectedThreadRef) !== null ||
              storeNow.getComposerDraft(draftId) !== expectedComposerDraft ||
              composerDraftHasUserContent(storeNow.getComposerDraft(draftId))
            ) {
              return;
            }
            storeNow.setDraftThreadContext(draftId, {
              envMode: resolvedEnvMode,
              startFromOrigin: resolvedStartFromOrigin,
            });
          },
          () => {
            // Missing, invalid, and unavailable project files all keep the
            // provisional project/global fallback without blocking navigation.
          },
        );
      };
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const hasStartFromOriginOption = options?.startFromOrigin !== undefined;
      const storedDraftThread = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      const storedDraftThreadRef = storedDraftThread
        ? scopeThreadRef(storedDraftThread.environmentId, storedDraftThread.threadId)
        : null;
      const reusableStoredDraftThread =
        storedDraftThread !== null &&
        storedDraftThread.promotedTo == null &&
        storedDraftThreadRef !== null &&
        readThreadShell(storedDraftThreadRef) === null
          ? storedDraftThread
          : null;
      if (storedDraftThreadRef && reusableStoredDraftThread === null) {
        markPromotedDraftThreadByRef(storedDraftThreadRef);
      }
      // New-thread surfaces (button, hotkeys, "/" landing, palette) only
      // ever reuse a draft the user has NOT invested in. A draft with typed
      // text or attachments is work in progress: it stays alive where it is
      // (reachable from the sidebar draft rows) and this request mints a
      // fresh draft instead — the remap in the store preserves invested
      // drafts rather than deleting them.
      const emptyStoredDraftThread =
        reusableStoredDraftThread &&
        !composerDraftHasUserContent(getComposerDraft(reusableStoredDraftThread.draftId))
          ? reusableStoredDraftThread
          : null;
      const latestActiveDraftThread: DraftThreadState | null = currentRouteTarget
        ? currentRouteTarget.kind === "server"
          ? getDraftThread(currentRouteTarget.threadRef)
          : getDraftSession(currentRouteTarget.draftId)
        : null;
      if (emptyStoredDraftThread) {
        return runDeduped(async () => {
          const isDraftAlreadyOpen =
            currentRouteTarget?.kind === "draft" &&
            currentRouteTarget.draftId === emptyStoredDraftThread.draftId;
          const hasExplicitWorkspaceOption =
            hasBranchOption ||
            hasWorktreePathOption ||
            hasEnvModeOption ||
            hasStartFromOriginOption;
          // Resurrecting an empty stored draft must not resurrect its stale
          // context: explicit workspace options win outright; otherwise the
          // env context resets to the configured defaults so drafts seeded
          // before a defaults change (or by the old carry-over behavior) stop
          // landing on "current checkout" branches forever. When the draft is
          // already open and no options were passed, leave its workspace
          // context alone entirely — the user may have just picked a branch
          // in the composer. Model selection has its own explicit-pick rule
          // below and does not follow this guard.
          let workspaceContext: NewThreadWorkspaceOptions | null = null;
          if (hasExplicitWorkspaceOption) {
            workspaceContext = pickExplicitWorkspaceOptions(options);
          } else if (!isDraftAlreadyOpen) {
            workspaceContext = {
              branch: null,
              worktreePath: null,
              envMode: immediateDefaultEnvMode,
              startFromOrigin: resolveNewDraftStartFromOrigin({
                envMode: immediateDefaultEnvMode,
                newWorktreesStartFromOrigin: primaryServerSettings.newWorktreesStartFromOrigin,
              }),
            };
          }
          if (workspaceContext) {
            setDraftThreadContext(emptyStoredDraftThread.draftId, {
              ...workspaceContext,
              ...(carryRuntimeMode ? { runtimeMode: carryRuntimeMode } : {}),
              ...(carryInteractionMode ? { interactionMode: carryInteractionMode } : {}),
            });
          }
          // Model intent: an explicit human pick always stands. Seeds and
          // legacy entries alike re-resolve here — sticky first, mirroring
          // the mint-fresh path, then the project default or carried
          // selection on top. This runs even when the draft is already open:
          // without it, a changed pin could never reach the draft the user
          // is looking at, because explicit picks are the only thing the
          // flag protects.
          const storedDraft = getComposerDraft(emptyStoredDraftThread.draftId);
          const storedActiveSelection = storedDraft?.activeProvider
            ? storedDraft.modelSelectionByProvider[storedDraft.activeProvider]
            : undefined;
          const storedDraftHasExplicitModelPick =
            Boolean(storedActiveSelection) && storedDraft?.modelSelectionExplicit === true;
          if (!storedDraftHasExplicitModelPick) {
            applyStickyState(emptyStoredDraftThread.draftId);
            const modelSelectionOverride = resolveModelSelectionOverride(
              emptyStoredDraftThread.draftId,
            );
            if (modelSelectionOverride) {
              // This is a complete snapshot: absent options mean "no options",
              // not "keep the stale draft's options".
              setModelSelection(emptyStoredDraftThread.draftId, modelSelectionOverride, {
                replaceOptions: true,
              });
            }
          }
          // The workspace context must also ride along here: when projectRef
          // targets a different physical member of the logical project,
          // createDraftThreadState treats the remap as a project change and
          // would otherwise wipe branch/worktree, undoing the write above.
          setLogicalProjectDraftThreadId(
            logicalProjectKey,
            projectRef,
            emptyStoredDraftThread.draftId,
            {
              threadId: emptyStoredDraftThread.threadId,
              ...workspaceContext,
              ...(carryRuntimeMode ? { runtimeMode: carryRuntimeMode } : {}),
              ...(carryInteractionMode ? { interactionMode: carryInteractionMode } : {}),
            },
          );
          carryComposerContentTo(emptyStoredDraftThread.draftId);
          const opened = {
            draftId: emptyStoredDraftThread.draftId,
            threadId: emptyStoredDraftThread.threadId,
          };
          // Re-read the route in case another entry point already opened this
          // reusable draft; navigating again would push a duplicate entry.
          const routeTargetAfterWrites = getCurrentRouteTarget();
          if (
            routeTargetAfterWrites?.kind === "draft" &&
            routeTargetAfterWrites.draftId === emptyStoredDraftThread.draftId
          ) {
            return opened;
          }
          const navigation = router.navigate({
            to: "/draft/$draftId",
            params: { draftId: emptyStoredDraftThread.draftId },
            replace: options?.replace ?? false,
          });
          if (!hasExplicitWorkspaceOption && !isDraftAlreadyOpen) {
            refineDefaultEnvModeAfterProjectFileRead(
              emptyStoredDraftThread.draftId,
              getDraftSession(emptyStoredDraftThread.draftId),
            );
          }
          await navigation;
          return opened;
        });
      }

      if (
        latestActiveDraftThread &&
        currentRouteTarget?.kind === "draft" &&
        latestActiveDraftThread.logicalProjectKey === logicalProjectKey &&
        latestActiveDraftThread.promotedTo == null &&
        // Same content rule as above: a new-thread request while viewing an
        // invested draft mints a fresh one instead of repurposing it.
        !composerDraftHasUserContent(getComposerDraft(currentRouteTarget.draftId))
      ) {
        if (
          hasBranchOption ||
          hasWorktreePathOption ||
          hasEnvModeOption ||
          hasStartFromOriginOption
        ) {
          setDraftThreadContext(currentRouteTarget.draftId, pickExplicitWorkspaceOptions(options));
        }
        setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, currentRouteTarget.draftId, {
          threadId: latestActiveDraftThread.threadId,
          createdAt: latestActiveDraftThread.createdAt,
          runtimeMode: latestActiveDraftThread.runtimeMode,
          interactionMode: latestActiveDraftThread.interactionMode,
          ...pickExplicitWorkspaceOptions(options),
        });
        return Promise.resolve({
          draftId: currentRouteTarget.draftId,
          threadId: latestActiveDraftThread.threadId,
        });
      }

      const draftId = newDraftId();
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return runDeduped(async () => {
        const initialEnvMode = options?.envMode ?? immediateDefaultEnvMode;
        setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, {
          threadId,
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: initialEnvMode,
          startFromOrigin:
            options?.startFromOrigin ??
            resolveNewDraftStartFromOrigin({
              envMode: initialEnvMode,
              newWorktreesStartFromOrigin: primaryServerSettings.newWorktreesStartFromOrigin,
            }),
          runtimeMode: carryRuntimeMode ?? DEFAULT_RUNTIME_MODE,
          ...(carryInteractionMode ? { interactionMode: carryInteractionMode } : {}),
        });
        applyStickyState(draftId);
        const modelSelectionOverride = resolveModelSelectionOverride(draftId);
        if (modelSelectionOverride) {
          // Project defaults and carried selections both outrank global sticky
          // state. The project default wins when both are present.
          setModelSelection(draftId, modelSelectionOverride, { replaceOptions: true });
        }
        carryComposerContentTo(draftId);

        const navigation = router.navigate({
          to: "/draft/$draftId",
          params: { draftId },
          replace: options?.replace ?? false,
        });
        if (options?.envMode === undefined) {
          refineDefaultEnvModeAfterProjectFileRead(draftId, getDraftSession(draftId));
        }
        await navigation;
        return { draftId, threadId };
      });
    },
    [
      getCurrentRouteTarget,
      inFlightNewThreadByLogicalProjectKey,
      primaryServerSettings,
      projectGroupingSettings,
      projects,
      router,
    ],
  );
}

export function useHandleNewThread() {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const activeThread = useThread(routeThreadRef);
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const activeDraftThread = useComposerDraftStore(() =>
    routeTarget
      ? routeTarget.kind === "server"
        ? getDraftThread(routeTarget.threadRef)
        : useComposerDraftStore.getState().getDraftSession(routeTarget.draftId)
      : null,
  );
  const projects = useProjects();
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
      getPreferenceIds: (project) => [
        getProjectOrderKey(project),
        legacyProjectCwdPreferenceKey(project.workspaceRoot),
      ],
    });
  }, [projectOrder, projects]);
  const handleNewThread = useNewThreadHandler();

  return {
    activeDraftThread,
    activeThread,
    defaultProjectRef: orderedProjects[0]
      ? scopeProjectRef(orderedProjects[0].environmentId, orderedProjects[0].id)
      : null,
    handleNewThread,
    routeThreadRef,
  };
}
