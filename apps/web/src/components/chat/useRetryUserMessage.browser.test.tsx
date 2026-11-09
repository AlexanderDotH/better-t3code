import { EnvironmentId, MessageId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { Atom, AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { act } from "../../../test/render";
import { draftSendState } from "./chatViewSend";
import { useRetryUserMessage } from "./useRetryUserMessage";
import { threadEnvironment } from "../../state/threads";
import { __setClientSettingsForTests } from "../../hooks/useSettings";

const state = vi.hoisted(() => ({ permitted: true, retry: vi.fn() }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.retry }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setup() {
  state.permitted = true;
  state.retry.mockReset();
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, experimentalFetch: true });
  const routeThreadKey = "retry:test:thread";
  draftSendState(routeThreadKey).sendInFlight.current = false;
  const context = {
    providerAvailable: true,
    selectedModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
    composerMode: "default" as const,
  };
  return {
    environmentId: EnvironmentId.make("retry:test"),
    threadId: ThreadId.make("thread"),
    routeThreadKey,
    currentRouteThreadKeyRef: { current: routeThreadKey },
    target: { messageId: MessageId.make("original"), runId: RunId.make("failed") },
    originalText: "Investigate the failure.",
    supported: true,
    supportsAgentWorkflow: true,
    blocked: false,
    composerRef: { current: { getSendContext: () => context } },
    setThreadError: vi.fn(),
    scrollToEnd: vi.fn(),
  };
}

function RetryButton(props: Parameters<typeof useRetryUserMessage>[0]) {
  const retry = useRetryUserMessage(props);
  return retry ? (
    <button
      type="button"
      disabled={!retry.available}
      onClick={() => {
        void retry.onRetry(retry.messageId);
        void retry.onRetry(retry.messageId);
      }}
    >
      {retry.pending ? "Retrying" : "Retry"}
    </button>
  ) : null;
}

it("retries only once with the selected model and original prompt context, preserving a newer route", async () => {
  const input = setup();
  using _permission = vi
    .spyOn(threadEnvironment.retryTurn, "permissionAtom")
    .mockImplementation(() => Atom.make(state.permitted));
  const result = deferred<ReturnType<typeof AsyncResult.success<void>>>();
  state.retry.mockReturnValue(result.promise);
  await using screen = await render(<RetryButton {...input} />);
  await screen.getByRole("button", { name: "Retry", exact: true }).click();
  expect(state.retry).toHaveBeenCalledOnce();
  expect(state.retry.mock.calls[0]?.[0]).toMatchObject({
    environmentId: input.environmentId,
    input: {
      type: "message.retry",
      threadId: input.threadId,
      messageId: input.target.messageId,
      runId: input.target.runId,
      modelSelection: input.composerRef.current.getSendContext().selectedModelSelection,
      fetchMode: "repository-exploration",
    },
  });
  expect(state.retry.mock.calls[0]?.[0].input).not.toHaveProperty("message");
  input.currentRouteThreadKeyRef.current = "another-thread";
  await act(async () => result.resolve(AsyncResult.success(undefined)));
  expect(input.scrollToEnd).not.toHaveBeenCalled();
  expect(draftSendState(input.routeThreadKey).sendInFlight.current).toBe(false);
});

it("keeps unsupported and unauthorized retries unavailable and releases failed requests", async () => {
  const input = setup();
  using _permission = vi
    .spyOn(threadEnvironment.retryTurn, "permissionAtom")
    .mockImplementation(() => Atom.make(state.permitted));
  state.permitted = false;
  await using screen = await render(<RetryButton {...input} />);
  await expect.element(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
  expect(state.retry).not.toHaveBeenCalled();
  await screen.rerender(<RetryButton {...input} supported={false} />);
  await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  state.permitted = true;
  state.retry.mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Retry refused"))));
  await screen.rerender(<RetryButton key="authorized" {...input} />);
  await screen.getByRole("button", { name: "Retry" }).click();
  await expect.element(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  expect(input.setThreadError).toHaveBeenLastCalledWith(input.threadId, "Retry refused");
  expect(draftSendState(input.routeThreadKey).sendInFlight.current).toBe(false);
});
