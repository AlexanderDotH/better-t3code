import { describe, expect, it } from "vite-plus/test";
import {
  chatMotionTiming,
  createChatMotionAdmission,
  type ChatMotionItem,
} from "./chat-presentation-motion";

const now = Date.parse("2026-10-26T12:00:00Z");
const item = (id: string, patch: Partial<ChatMotionItem> = {}): ChatMotionItem => ({
  id,
  createdAt: new Date(now).toISOString(),
  kind: "user",
  revision: id,
  ...patch,
});

function harness() {
  const registry = createChatMotionAdmission();
  const observe = (
    items: ChatMotionItem[],
    patch: Partial<Parameters<typeof registry.observe>[0]> = {},
  ) => {
    registry.observe({
      context: "thread:better-t3:connected:1",
      enabled: true,
      items,
      now,
      characterStreamingMotion: false,
      ...patch,
    });
  };
  return { registry, observe };
}

describe("native chat motion admission", () => {
  it("suppresses the initial snapshot and claims new arrivals once across row recycling", () => {
    const { registry, observe } = harness();
    observe([item("history")]);
    expect(registry.claim("history", now)).toBeNull();
    observe([item("history"), item("new")]);
    expect(registry.claim("new", now)?.kind).toBe("user");
    observe([item("history"), item("new")]);
    expect(registry.claim("new", now)).toBeNull();
  });

  it("does not animate history, hidden tool details, stale arrivals, or future timestamps", () => {
    const { registry, observe } = harness();
    observe([item("tail")]);
    const hidden = item("hidden", { kind: "result", presented: false });
    observe([
      item("older", { createdAt: new Date(now - 1).toISOString() }),
      item("stale", { createdAt: new Date(now - 2_001).toISOString() }),
      item("future", { createdAt: new Date(now + 1).toISOString() }),
      item("tail"),
      hidden,
    ]);
    for (const id of ["older", "stale", "future", "hidden"])
      expect(registry.claim(id, now)).toBeNull();
    observe([item("tail"), { ...hidden, presented: true }]);
    expect(registry.claim("hidden", now)).toBeNull();
  });

  it.each([
    "thread:current:connected:1",
    "thread:classic:connected:1",
    "thread:better-t3:connected:2",
    "another:better-t3:connected:1",
  ])("baselines a mode, reconnect generation, or thread change: %s", (context) => {
    const { registry, observe } = harness();
    observe([]);
    observe([item("before")]);
    observe([item("before"), item("snapshot")], { context });
    expect(registry.claim("before", now)).toBeNull();
    expect(registry.claim("snapshot", now)).toBeNull();
  });

  it("discards pending arrivals when disabled or backgrounded and never replays them on resume", () => {
    const { registry, observe } = harness();
    observe([]);
    observe([item("first")]);
    observe([item("first"), item("background")], { enabled: false });
    observe([item("first"), item("background")]);
    expect(registry.claim("first", now)).toBeNull();
    expect(registry.claim("background", now)).toBeNull();
    observe([item("first"), item("background"), item("fresh")]);
    expect(registry.claim("fresh", now)?.kind).toBe("user");
  });

  it("requires character motion for response text and clears pending text when it is disabled", () => {
    const { registry, observe } = harness();
    const response = item("answer", { kind: "response" });
    observe([]);
    observe([response]);
    expect(registry.claim(response.id, now)).toBeNull();
    const next = item("next", { kind: "response" });
    observe([response, next], { characterStreamingMotion: true });
    observe([response, next]);
    expect(registry.claim(next.id, now)).toBeNull();
  });

  it("animates the decorative assistant bubble while unsupported text motion stays disabled", () => {
    const { registry, observe } = harness();
    observe([]);
    observe([item("answer", { kind: "response" }), item("surface:answer", { kind: "surface" })]);
    expect(registry.claim("answer", now)).toBeNull();
    const surface = registry.claim("surface:answer", now);
    expect(surface?.kind).toBe("surface");
    expect(chatMotionTiming("surface")).toEqual({ duration: 240, translateY: 0 });
  });

  it("bounds result stagger plus duration to 360ms and leaves stream chunks still", () => {
    const { registry, observe } = harness();
    observe([]);
    const results = Array.from({ length: 20 }, (_, index) =>
      item(`result-${index}`, { kind: "result" }),
    );
    observe(results);
    expect(registry.claim("result-1", now)?.delay).toBe(40);
    const last = registry.claim("result-19", now)!;
    expect(last.delay + chatMotionTiming(last.kind).duration).toBe(360);
    expect(chatMotionTiming("user")).toEqual({ duration: 320, translateY: 12 });
    expect(chatMotionTiming("response")).toEqual({ duration: 360, translateY: 10 });
    expect(chatMotionTiming("status")).toEqual({ duration: 160, translateY: 0 });
  });

  it("animates real status changes once, without a recurring timer", () => {
    const { registry, observe } = harness();
    const status = item("status", { kind: "status", revision: "Reading" });
    observe([status]);
    observe([{ ...status, revision: "Completed" }]);
    expect(registry.claim("status", now)?.kind).toBe("status");
    observe([{ ...status, revision: "Completed" }]);
    expect(registry.claim("status", now)).toBeNull();
  });

  it("consumes offscreen arrivals when scrolling and expires never-mounted rows", () => {
    const { registry, observe } = harness();
    observe([]);
    observe([item("offscreen")]);
    registry.discardPending();
    expect(registry.claim("offscreen", now + 100)).toBeNull();
    observe([item("offscreen"), item("unmounted")]);
    expect(registry.claim("unmounted", now + 601)).toBeNull();
  });

  it("only grants detail fades for explicit disclosure actions while enabled", () => {
    const { registry, observe } = harness();
    observe([]);
    registry.disclose("detail:tool", now);
    expect(registry.claim("detail:tool", now)?.kind).toBe("status");
    expect(registry.claim("detail:tool", now)).toBeNull();
    observe([], { enabled: false });
    registry.disclose("detail:tool", now);
    expect(registry.claim("detail:tool", now)).toBeNull();
  });
});
