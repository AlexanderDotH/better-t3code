// @vitest-environment jsdom
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  EventId,
  SubagentId,
  ThreadId,
  type OrchestrationSubagentSummary,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ReplyTopicControls } from "./ReplyTopicControls";

const commands = vi.hoisted(() => ({
  interrupt: vi.fn(),
  retry: vi.fn(),
  approval: vi.fn(),
  input: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../../state/threads", () => ({
  threadEnvironment: {
    interruptReply: "interrupt",
    retryReply: "retry",
    respondToReplyApproval: "approval",
    respondToReplyUserInput: "input",
    dismissReplyUserInput: "dismiss",
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (key: keyof typeof commands) => commands[key],
}));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));
const threadRef = scopeThreadRef(
  EnvironmentId.make("test-environment"),
  ThreadId.make("root-thread"),
);
const timestamp = "2026-10-01T00:00:00.000Z";

function topic(
  id: string,
  status: OrchestrationSubagentSummary["status"] = "waiting",
): OrchestrationSubagentSummary {
  return {
    id: SubagentId.make(id),
    origin: "t3-managed",
    providerInstanceId: null,
    providerDriver: null,
    providerThreadId: id,
    parentId: null,
    path: null,
    name: id,
    nickname: null,
    role: null,
    task: null,
    model: null,
    reasoningEffort: null,
    depth: 1,
    status,
    statusMessage: null,
    latestProgress: null,
    latestTurn: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  };
}
function activity(
  topicId: string,
  kind: string,
  payload: Record<string, unknown>,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`${topicId}:${kind}`),
    replyTopicId: SubagentId.make(topicId),
    turnId: null,
    kind,
    payload: { requestId: "reused-request-id", ...payload },
    createdAt: timestamp,
    tone: "info",
    summary: kind,
  };
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  for (const command of Object.values(commands))
    command.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("inline reply topic controls", () => {
  it("keeps another topic's reused approval ID pending and targets its provider session", async () => {
    const activities = [
      activity("first", "approval.requested", { detail: "First command", requestKind: "command" }),
      activity("second", "approval.requested", {
        detail: "Second command",
        requestKind: "command",
      }),
      activity("first", "approval.resolved", {}),
    ];
    act(() =>
      root.render(
        <>
          <ReplyTopicControls
            enabled
            threadRef={threadRef}
            topic={topic("first")}
            activities={activities}
          />
          <ReplyTopicControls
            enabled
            threadRef={threadRef}
            topic={topic("second")}
            activities={activities}
          />
        </>,
      ),
    );
    expect(container.querySelector("[data-reply-topic-id=first]")?.textContent).not.toContain(
      "First command",
    );
    const approval = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[data-reply-topic-id=second] button"),
    ).find((button) => button.textContent === "Approve")!;
    expect(approval).toBeDefined();
    await act(async () => approval.click());
    expect(commands.approval).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        replyTopicId: "second",
        requestId: "reused-request-id",
        decision: "accept",
      },
    });
  });

  it("answers a topic's question without consuming another topic's matching ID", async () => {
    const question = {
      id: "question",
      header: "Choice",
      question: "Which option?",
      options: [{ label: "Use this", description: "This option" }],
      allowCustomAnswer: false,
    };
    const activities = [
      activity("first", "user-input.requested", { questions: [question] }),
      activity("second", "user-input.requested", { questions: [question] }),
      activity("first", "user-input.resolved", {}),
    ];
    act(() =>
      root.render(
        <ReplyTopicControls
          enabled
          threadRef={threadRef}
          topic={topic("second")}
          activities={activities}
        />,
      ),
    );
    const option = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Use this",
    )!;
    act(() => option.click());
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(commands.input).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        replyTopicId: "second",
        requestId: "reused-request-id",
        answers: { question: "Use this" },
      },
    });
  });

  it("retries only the failed topic and disables its controls when disconnected", async () => {
    act(() =>
      root.render(
        <ReplyTopicControls
          enabled
          threadRef={threadRef}
          topic={topic("failed", "error")}
          activities={[]}
        />,
      ),
    );
    const retry = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => retry.click());
    expect(commands.retry).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, replyTopicId: "failed" },
    });
    act(() =>
      root.render(
        <ReplyTopicControls
          enabled={false}
          threadRef={threadRef}
          topic={topic("failed", "error")}
          activities={[]}
        />,
      ),
    );
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  });
});
