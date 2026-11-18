import {
  EnvironmentId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Subagent,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../test/render";
import { ThreadSubagents } from "./ThreadSubagents";
import { ChatCanvas } from "./chat/ChatCanvas";
import { useChatCanvas } from "./chat/ChatCanvasContext";
import { createChatCanvasStore } from "./chat/canvasStore";

function ScrollableConversation() {
  const canvas = useChatCanvas();
  return (
    <section
      aria-label="Conversation"
      ref={canvas?.registerTimeline}
      className="absolute inset-0 overflow-y-auto"
    >
      <div className="h-[200%]">Chat content</div>
    </section>
  );
}

it("starts with history collapsed and closes it when the conversation scrolls", async () => {
  const threadRef = {
    environmentId: EnvironmentId.make("env-1"),
    threadId: ThreadId.make("thread-1"),
  };
  const remoteEnvironment = EnvironmentId.make("env-2");
  const completedAt = DateTime.makeUnsafe("2026-07-30T10:00:00.000Z");
  const now = DateTime.makeUnsafe("2026-07-30T10:01:00.000Z");
  using _now = vi.spyOn(Date, "now").mockReturnValue(DateTime.toEpochMillis(now));
  const providersByEnvironment = new Map<EnvironmentId, readonly ServerProvider[]>([
    [
      remoteEnvironment,
      [
        {
          driver: ProviderDriverKind.make("codex"),
          instanceId: ProviderInstanceId.make("remote-codex"),
          displayName: "Codex",
          enabled: true,
          installed: true,
          version: null,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: DateTime.formatIso(now),
          models: [],
          slashCommands: [],
          skills: [],
        },
      ],
    ],
  ]);
  const completedAgent: OrchestrationV2Subagent = {
    id: NodeId.make("finished-agent"),
    threadId: threadRef.threadId,
    runId: null,
    parentNodeId: NodeId.make("parent"),
    origin: "provider_native",
    createdBy: "agent",
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    driver: ProviderDriverKind.make("claudeAgent"),
    providerThreadId: null,
    childThreadId: null,
    nativeTaskRef: null,
    title: "Finished agent",
    prompt: "Check the earlier change",
    model: null,
    status: "completed",
    result: null,
    startedAt: DateTime.makeUnsafe("2026-07-30T09:00:00.000Z"),
    updatedAt: completedAt,
    completedAt,
  };
  const runningAgent: OrchestrationV2Subagent = {
    ...completedAgent,
    id: NodeId.make("running-agent"),
    origin: "app_owned",
    providerInstanceId: ProviderInstanceId.make("remote-codex"),
    driver: ProviderDriverKind.make("remote"),
    remoteChild: {
      environmentId: remoteEnvironment,
      threadId: ThreadId.make("remote-thread"),
      label: "Remote",
    },
    title: "Running agent",
    status: "running",
    completedAt: null,
  };
  const store = createChatCanvasStore();
  const chat = (subagents: readonly OrchestrationV2Subagent[]) => (
    <div data-chat-column className="@container/chat-column flex h-96 w-88">
      <ChatCanvas store={store} threadRef={threadRef} preview={null} composerOverlayElement={null}>
        <ScrollableConversation />
        <ThreadSubagents
          threadRef={threadRef}
          subagents={subagents}
          providersByEnvironment={providersByEnvironment}
          timestampFormat="24-hour"
        />
      </ChatCanvas>
    </div>
  );
  await using screen = await render(chat([runningAgent, completedAgent]));

  const agent = screen.getByRole("button", { name: /Finished agent/ });
  const history = screen.getByRole("button", { name: /^History/ });
  const running = screen.getByRole("button", { name: /Running agent/ });
  await expect.element(history).toHaveAttribute("aria-expanded", "false");
  await expect.element(agent).not.toBeInTheDocument();
  await expect.element(running).toBeVisible();
  await history.click();
  await expect.element(agent).toBeVisible();
  expect(running.element().querySelector("svg")?.getAttribute("viewBox")).toBe("100 100 411 411");
  expect(agent.element().querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 256 257");

  const overlay = screen.getByRole("region", { name: "Agents" }).element();
  const conversation = screen.getByRole("region", { name: "Conversation" }).element();
  const conversationBounds = conversation.getBoundingClientRect();
  const bounds = overlay.getBoundingClientRect();
  expect(bounds.width).toBeLessThan(conversationBounds.width / 2);
  expect(bounds.height).toBeLessThan(conversationBounds.height / 2);
  expect(getComputedStyle(overlay).backdropFilter).toContain("blur(");

  for (const scrollTop of [100, 0]) {
    conversation.scrollTop = scrollTop;
    await expect.element(history).toHaveAttribute("aria-expanded", "false");
    await expect.element(agent).not.toBeInTheDocument();
    await expect.element(running).toBeVisible();
    await history.click();
    await expect.element(agent).toBeVisible();
  }
  await screen.getByRole("button", { name: /^Agents/ }).click();
  await expect.element(agent).not.toBeInTheDocument();
  await screen.getByRole("button", { name: /^Agents/ }).click();
  await expect.element(agent).toBeVisible();
  await screen.getByRole("button", { name: /^Agents/ }).click();

  await screen.rerender(
    chat([
      { ...runningAgent, status: "completed", completedAt: now, updatedAt: now },
      completedAgent,
    ]),
  );
  await expect.element(screen.getByRole("button", { name: /^Agents/ })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("region", { name: "History" })).toBeVisible();
  await expect.element(agent).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /Running agent, Completed/ }))
    .toBeVisible();
});
