import { describe, expect, it } from "vite-plus/test";
import {
  advanceChatPresentationMotion,
  chatPresentationAnimation,
  type ChatPresentationContent,
  type ChatPresentationMotionInput,
} from "./chatPresentationMotion";

function content(id: string, second: number, ready = true): ChatPresentationContent {
  return {
    id,
    createdAt: `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
    kind: "assistant",
    ready,
  };
}

function input(contents: readonly ChatPresentationContent[]): ChatPresentationMotionInput {
  return {
    identity: "thread:1",
    mode: "better-t3",
    enabled: true,
    visible: true,
    connected: true,
    contents,
  };
}

describe("chat presentation motion admission", () => {
  it("keeps initial history, prepends, and previously consumed content still", () => {
    const old = content("old", 1);
    const recent = content("recent", 2);
    const first = advanceChatPresentationMotion(null, input([recent]));
    expect(first.admitted).toEqual([]);
    const backfill = advanceChatPresentationMotion(first.state, input([old, recent]));
    expect(backfill.admitted).toEqual([]);
    const newest = content("new", 3);
    const append = advanceChatPresentationMotion(backfill.state, input([old, recent, newest]));
    expect(append.admitted.map((item) => item.id)).toEqual(["new"]);
    expect(
      advanceChatPresentationMotion(append.state, input([old, recent, newest])).admitted,
    ).toEqual([]);
  });

  it("admits the first visible text of a live empty response only once", () => {
    const history = content("history", 1);
    const first = advanceChatPresentationMotion(null, input([history]));
    const empty = content("stream", 2, false);
    const append = advanceChatPresentationMotion(first.state, input([history, empty]));
    expect(append.admitted).toEqual([]);
    const ready = { ...empty, ready: true };
    const reveal = advanceChatPresentationMotion(append.state, input([history, ready]));
    expect(reveal.admitted.map((item) => item.id)).toEqual(["stream"]);
    expect(advanceChatPresentationMotion(reveal.state, input([history, ready])).admitted).toEqual(
      [],
    );
  });

  it.each([
    { mode: "current" },
    { enabled: false },
    { visible: false },
    { connected: false },
    { identity: "thread:2" },
  ])("baselines changes across a presentation boundary %j", (boundary) => {
    const history = content("history", 1);
    const first = advanceChatPresentationMotion(null, input([history]));
    const arrived = content("during-boundary", 2);
    const paused = advanceChatPresentationMotion(first.state, {
      ...input([history, arrived]),
      ...boundary,
    });
    const resumed = advanceChatPresentationMotion(paused.state, input([history, arrived]));
    expect(resumed.admitted).toEqual([]);
  });

  it("suppresses a batched reconnect even when no disconnected render happened", () => {
    const old = content("old", 1);
    const first = advanceChatPresentationMotion(null, input([old]));
    const recovered = advanceChatPresentationMotion(first.state, {
      ...input([old, content("recovered", 2)]),
      identity: "thread:next-connection",
    });
    expect(recovered.admitted).toEqual([]);
  });

  it("fades an actual tool status change without replaying its unchanged state", () => {
    const tool = { ...content("tool", 1), kind: "status" as const, revision: "inProgress" };
    const first = advanceChatPresentationMotion(null, input([tool]));
    const completed = { ...tool, revision: "completed" };
    const update = advanceChatPresentationMotion(first.state, input([completed]));
    expect(update.admitted).toEqual([completed]);
    expect(advanceChatPresentationMotion(update.state, input([completed])).admitted).toEqual([]);
  });
});

describe("chat presentation motion bounds", () => {
  it("moves incoming messages without masking character reveals", () => {
    const user = chatPresentationAnimation("user", 0, true);
    const assistant = chatPresentationAnimation("assistant", 0, true);
    expect(user.options.duration).toBe(0.32);
    expect(user.keyframes.transform?.[0]).toBe("translateY(12px)");
    expect(assistant.options.duration).toBe(0.36);
    expect(assistant.keyframes.transform?.[0]).toBe("translateY(10px)");
    expect(assistant.keyframes.opacity).toBeUndefined();
  });

  it("caps the whole result sequence at 360ms", () => {
    const second = chatPresentationAnimation("result", 1, true);
    expect(second.options.delay).toBe(0.04);
    const last = chatPresentationAnimation("result", 99, true);
    expect(Number(last.options.delay) + Number(last.options.duration)).toBe(0.36);
    expect(chatPresentationAnimation("status", 99, true).options.duration).toBe(0.16);
  });

  it("keeps message entrances independent of character animation", () => {
    const user = chatPresentationAnimation("user", 0, false);
    const assistant = chatPresentationAnimation("assistant", 0, false);
    expect(user.options.duration).toBe(0.32);
    expect(assistant.options.duration).toBe(0.36);
    expect(user.keyframes).toEqual({
      opacity: [0, 1],
      transform: ["translateY(12px)", "translateY(0)"],
    });
    expect(assistant.keyframes).toEqual({
      opacity: [0, 1],
      transform: ["translateY(10px)", "translateY(0)"],
    });
  });
});
