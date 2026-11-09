import * as Cause from "effect/Cause";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import {
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";

const fixture = vi.hoisted(() => ({
  capability: true,
  draft: {} as { composerMode?: string; modelSelection?: unknown },
  experimentalFetch: true,
  modelUnavailable: false,
  retryTurn: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  alert: vi.fn(),
}));
vi.mock("expo-haptics", () => ({ selectionAsync: async () => undefined }));
vi.mock("../../components/ui/Dialog", () => ({ alert: fixture.alert }));
vi.mock("../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () => ({ message: (key: string) => key }),
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "retry-command" }));
vi.mock("../../lib/modelOptions", () => ({
  isModelSelectionUnavailable: () => fixture.modelUnavailable,
  describeUnavailableModelSelection: () => ({ title: "Unavailable", detail: "Pick another" }),
}));
vi.mock("@t3tools/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/contracts")>()),
  resolveResultlessRetryTarget: () => ({
    messageId: "prompt",
    runId: "run-1",
  }),
}));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useRemoteEnvironmentRuntime: () => ({
    connectionState: "connected",
    serverConfig: {
      environment: {
        capabilities: { threadRetry: fixture.capability, agentWorkflowVersion: 1 },
      },
    },
  }),
}));
vi.mock("../../state/threads", async () => {
  const { Atom } = await import("effect/reactivity");
  const permitted = Atom.make(true);
  return { threadEnvironment: { retryTurn: { permissionAtom: () => permitted } } };
});
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => fixture.retryTurn }));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerDraftSnapshot: () => fixture.draft,
}));
vi.mock("../../state/preferences", () => ({ mobilePreferencesAtom: "preferences" }));
vi.mock("../../state/atom-registry", async () => {
  const { AsyncResult } = await import("effect/reactivity");
  return {
    appAtomRegistry: {
      get: () => AsyncResult.success({ experimentalFetch: fixture.experimentalFetch }),
    },
  };
});

import { useThreadRetryAction } from "./use-thread-retry-action";

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const threadModel = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
const projection = {
  thread: { id: threadId, modelSelection: threadModel, interactionMode: "default" },
  messages: [{ id: MessageId.make("prompt"), text: "Try again" }],
} as unknown as OrchestrationV2ThreadProjection;

async function retryAction() {
  const current: { value: ReturnType<typeof useThreadRetryAction> } = { value: null };
  function Probe() {
    const action = useThreadRetryAction({ environmentId, threadId, projection });
    useLayoutEffect(() => {
      current.value = action;
    }, [action]);
    return null;
  }
  const renderer = createRoot(document.createElement("div"));
  await act(() => {
    renderer.render(<Probe />);
  });
  onTestFinished(async () => {
    await act(() => renderer.unmount());
  });
  return current;
}

const retryInput = (fetchMode: "repository-exploration" | null) => ({
  environmentId,
  input: {
    type: "message.retry",
    commandId: "retry-command",
    threadId,
    messageId: "prompt",
    runId: RunId.make("run-1"),
    modelSelection: threadModel,
    fetchMode,
  },
});

beforeEach(() => {
  fixture.capability = true;
  fixture.draft = {};
  fixture.experimentalFetch = true;
  fixture.modelUnavailable = false;
  fixture.retryTurn.mockReset();
  fixture.retryTurn.mockResolvedValue({ _tag: "Success" });
  fixture.alert.mockReset();
});

describe("mobile retry of an unanswered message", () => {
  it("is offered only by servers that support it", async () => {
    fixture.capability = false;
    expect((await retryAction()).value).toBeNull();
    fixture.capability = true;
    expect((await retryAction()).value).toMatchObject({ messageId: "prompt", available: true });
  });

  it("resends with Fetch for agent turns and without it in Chat mode", async () => {
    const action = await retryAction();
    await act(async () => action.value?.onRetry());
    expect(fixture.retryTurn).toHaveBeenLastCalledWith(retryInput("repository-exploration"));

    fixture.draft = { composerMode: "chat" };
    await act(async () => action.value?.onRetry());
    expect(fixture.retryTurn).toHaveBeenLastCalledWith(retryInput(null));
  });

  it("explains an unavailable model instead of sending", async () => {
    fixture.modelUnavailable = true;
    const action = await retryAction();
    await act(async () => action.value?.onRetry());
    expect(fixture.retryTurn).not.toHaveBeenCalled();
    expect(fixture.alert).toHaveBeenCalledWith("Unavailable", "Pick another");
  });

  it("ignores repeat taps while pending and can retry after a rejection", async () => {
    let settle!: (result: unknown) => void;
    fixture.retryTurn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const action = await retryAction();
    await act(async () => {
      action.value?.onRetry();
      action.value?.onRetry();
    });
    expect(fixture.retryTurn).toHaveBeenCalledTimes(1);
    expect(action.value).toMatchObject({ pending: true, available: false });

    await act(async () =>
      settle({ _tag: "Failure", cause: Cause.fail(new Error("Provider refused")) }),
    );
    expect(fixture.alert).toHaveBeenCalledWith("mobile.thread.retryFailed", "Provider refused");
    expect(action.value).toMatchObject({ pending: false, available: true });

    await act(async () => action.value?.onRetry());
    expect(fixture.retryTurn).toHaveBeenCalledTimes(2);
  });
});
