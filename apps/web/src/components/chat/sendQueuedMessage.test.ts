import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  run: vi.fn(),
  toast: vi.fn(),
  supported: true,
  nextId: 0,
  api: {},
}));

vi.mock("@t3tools/client-runtime/deep-planning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/deep-planning")>()),
  prepareDeepPlanForTurn: mocks.prepare,
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: mocks.run,
  squashAtomCommandFailure: (result: { error: unknown }) => result.error,
}));
vi.mock("../../state/threads", () => ({
  threadEnvironment: {
    updateMetadata: "metadata",
    setRuntimeMode: "runtime",
    setInteractionMode: "mode",
    startTurn: "turn",
  },
}));
vi.mock("../../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () =>
      new Map([
        [
          "environment",
          {
            environment: {
              capabilities: {
                deepPlanning: mocks.supported
                  ? { version: 1, sourceExport: true, sourceImport: true }
                  : undefined,
              },
            },
            providers: [
              {
                instanceId: "provider",
                enabled: true,
                installed: true,
                deepPlanning: { version: 1, structuredPlans: true, durableExecution: true },
              },
            ],
          },
        ],
      ]),
  },
}));
vi.mock("../../state/server", () => ({ environmentServerConfigsAtom: {} }));
vi.mock("../../state/entities", () => ({
  readThread: () => ({ activities: [] }),
  readThreadShell: () => ({
    projectId: "project",
    title: "Queued work",
    modelSelection: { instanceId: "provider", model: "model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
  }),
}));
vi.mock("../../state/deepPlanning", () => ({ getWebDeepPlanningApi: () => mocks.api }));
vi.mock("../../lib/utils", () => ({
  randomUUID: () => `id-${++mocks.nextId}`,
  newMessageId: () => `message-${++mocks.nextId}`,
}));
vi.mock("../../lib/attachmentUploadQueue", () => ({
  awaitAttachmentUploads: vi.fn(),
  getUploadedAttachments: vi.fn(),
  releaseDraftAttachments: vi.fn(),
  startAttachmentUpload: vi.fn(),
}));
vi.mock("../../lib/composerContextRecords", () => ({
  buildMessageContext: () => undefined,
  terminalContextReference: () => ({ contextId: "terminal" }),
}));
vi.mock("../ChatView.logic", () => ({
  createLocalDispatchSnapshot: () => ({}),
  deriveComposerSendState: () => ({ sendableTerminalContexts: [], hasSendableContent: true }),
  resolveThreadMetadataUpdateForNextTurn: () => null,
  readFileAsDataUrl: vi.fn(),
  revokeBlobPreviewUrl: vi.fn(),
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: mocks.toast } }));
vi.mock("./composerAttachmentFiles", () => ({ fileAttachmentCapabilityBlockReason: () => null }));

import { useQueuedMessageStore } from "../../queuedMessageStore";
import { sendQueuedMessage } from "./sendQueuedMessage";

const threadRef = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const threadKey = scopedThreadKey(threadRef);
const sources = [
  {
    environmentId: EnvironmentId.make("remote"),
    projectId: ProjectId.make("remote-project"),
    threadId: ThreadId.make("source"),
  },
];

function enqueue(deep = true) {
  return useQueuedMessageStore.getState().enqueue(threadKey, {
    prompt: "Inspect the complete project",
    images: [],
    files: [],
    terminalContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    sendSettings: {
      modelSelection: { instanceId: ProviderInstanceId.make("provider"), model: "model" },
      runtimeMode: "full-access",
      interactionMode: "default",
      composerMode: deep ? "deep-plan" : "default",
      deepPlanSourceRefs: sources,
      promptEffort: null,
    },
    queuedAfterToolActivityId: null,
    createdAt: "2026-10-16T08:00:00.000Z",
  });
}

beforeEach(() => {
  useQueuedMessageStore.setState({ queuesByThreadKey: {}, lastDispatchByThreadKey: {} });
  mocks.prepare.mockReset();
  mocks.prepare.mockResolvedValue({});
  mocks.run.mockReset();
  mocks.run.mockResolvedValue({ _tag: "Success", value: {} });
  mocks.toast.mockClear();
  mocks.supported = true;
});

describe("queued DeepPlan send", () => {
  it("prepares the queued source selection before starting an ordinary provider plan turn", async () => {
    const message = enqueue();
    await sendQueuedMessage(threadRef, message.id);
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        ...threadRef,
        projectId: "project",
        additionalSourceRefs: sources,
      }),
    );
    const turn = mocks.run.mock.calls.find(([, command]) => command === "turn");
    expect(turn?.[2]).toMatchObject({
      environmentId: "environment",
      input: { interactionMode: "plan" },
    });
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.run.mock.invocationCallOrder[0]!,
    );
    expect(useQueuedMessageStore.getState().queuesByThreadKey[threadKey]).toBeUndefined();
  });

  it("holds failed preparation with the same DeepPlan choices and sends no ordinary turn", async () => {
    mocks.prepare.mockRejectedValue(new Error("Remote source is unavailable"));
    const message = enqueue();
    await sendQueuedMessage(threadRef, message.id);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(useQueuedMessageStore.getState().queuesByThreadKey[threadKey]?.[0]).toMatchObject({
      id: message.id,
      holdUntilUserAction: true,
      sendSettings: { composerMode: "deep-plan", deepPlanSourceRefs: sources },
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Remote source is unavailable" }),
    );
  });

  it("blocks old servers without preparing or falling back to a normal turn", async () => {
    mocks.supported = false;
    const message = enqueue();
    await sendQueuedMessage(threadRef, message.id);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(
      useQueuedMessageStore.getState().queuesByThreadKey[threadKey]?.[0]?.holdUntilUserAction,
    ).toBe(true);
  });

  it("cancels source preparation when Stop takes the queued message back", async () => {
    mocks.prepare.mockImplementation(async (input: { signal: AbortSignal }) => {
      useQueuedMessageStore.getState().drain(threadKey);
      expect(input.signal.aborted).toBe(true);
      throw new Error("Canceled");
    });
    const message = enqueue();
    await sendQueuedMessage(threadRef, message.id);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("keeps ordinary queued Build sends on their existing path", async () => {
    const message = enqueue(false);
    await sendQueuedMessage(threadRef, message.id);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.run.mock.calls.find(([, command]) => command === "turn")?.[2]).toMatchObject({
      input: { interactionMode: "default" },
    });
  });
});
