import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ remember: vi.fn<(input: unknown) => Promise<void>>() }));
vi.mock("../../state/server", () => ({ serverEnvironment: { rememberProjectChatSettings: {} } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.remember }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
vi.mock("../ChatView.logic", () => ({
  getStartedThreadModelChangeBlockReason: () => null,
  deriveLockedProvider: () => null,
  makeModelDisabledReason: () => () => undefined,
}));

import { useComposerDraftStore } from "../../composerDraftStore";
import { useComposerSelection } from "./useComposerSelection";

it.each([true, false])(
  "remembers manual model options only when the environment supports it: %s",
  async (supportsProjectChatSettings) => {
    mocks.remember.mockReset().mockResolvedValue(undefined);
    const environmentId = EnvironmentId.make(`project-preferences-${supportsProjectChatSettings}`);
    const threadId = ThreadId.make("new-thread");
    const projectId = ProjectId.make("project-preferences");
    const target = scopeThreadRef(environmentId, threadId);
    const modelSelection: ModelSelection = {
      instanceId: ProviderInstanceId.make("codex-team"),
      model: "gpt-options",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "contextWindow", value: "1000000" },
        { id: "serviceTier", value: "priority" },
        { id: "t3AutoReasoning", value: true },
      ],
    };
    useComposerDraftStore.getState().setPrompt(target, "Keep this unsent prompt.");
    let controller: ReturnType<typeof useComposerSelection> | undefined;
    function Harness() {
      const input = {
        environmentId,
        composerDraftTarget: target,
        draftThread: {
          environmentId,
          threadId,
          projectId,
          logicalProjectKey: "project-preferences",
          createdAt: "2026-11-03T10:00:00.000Z",
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
          branch: null,
          worktreePath: null,
          envMode: "local" as const,
          startFromOrigin: false,
        },
        activeThread: undefined,
        activeRuntime: null,
        activeProjectSettings: { settings: { newWorktreesStartFromOrigin: false } },
        settings: DEFAULT_UNIFIED_SETTINGS,
        providerStatuses: [],
        lockedProvider: null,
        supportsProviderSwitchingViaHandoff: true,
        supportsProjectChatSettings,
        multipleModelSelections: null,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        composerMode: "deep-plan" as const,
        deepPlanningSupported: true,
        interactionModeEnabled: true,
        isLocalDraftThread: true,
        canOverrideServerThreadEnvMode: false,
        setPendingServerThreadEnvModeEntry: () => {},
        setPendingServerThreadStartFromOriginByThreadId: () => {},
        scheduleComposerFocus: () => {},
      };
      const selection = useComposerSelection(input);
      useLayoutEffect(() => {
        controller = selection;
      });
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(<Harness />);
      });
      await act(() => controller!.handleManualModelSelectionChangeStable(modelSelection));
      expect(useComposerDraftStore.getState().getComposerDraft(target)).toMatchObject({
        prompt: "Keep this unsent prompt.",
        activeProvider: modelSelection.instanceId,
        modelSelectionExplicit: true,
        modelSelectionByProvider: { [modelSelection.instanceId]: modelSelection },
      });
      if (supportsProjectChatSettings) {
        expect(mocks.remember).toHaveBeenCalledExactlyOnceWith({
          environmentId,
          projectId,
          settings: { modelSelection, runtimeMode: "full-access", composerMode: "deep-plan" },
        });
      } else {
        expect(mocks.remember).not.toHaveBeenCalled();
      }
    } finally {
      await act(async () => renderer?.unmount());
    }
  },
);
