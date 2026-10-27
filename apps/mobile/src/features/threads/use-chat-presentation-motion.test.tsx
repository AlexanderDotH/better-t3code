// @vitest-environment jsdom

import {
  EnvironmentId,
  MessageId,
  TurnId,
  type OrchestrationCheckpointSummary,
} from "@t3tools/contracts";
import { resolveChatPresentation } from "@t3tools/client-runtime/chat-presentation";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { ThreadFeedEntry } from "../../lib/threadActivity";

const native = vi.hoisted(() => ({
  generation: 1,
  focused: true,
  listeners: new Set<(state: string) => void>(),
}));
let presentation = resolveChatPresentation({
  mode: "current",
  presentationMotion: true,
  characterStreamingMotion: false,
  reducedMotion: false,
});
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (state: string) => void) => {
      native.listeners.add(callback);
      return { remove: () => native.listeners.delete(callback) };
    },
  },
}));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => native.focused }));
vi.mock("../../connection/catalog", () => ({ environmentCatalog: { stateAtom: () => ({}) } }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: { generation: native.generation } }),
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ chatPresentation: presentation }),
}));

import { useNativeChatPresentationMotion } from "./use-chat-presentation-motion";

const now = Date.parse("2026-10-26T12:00:00Z");
const message = (id: string, text = "Answer"): ThreadFeedEntry => ({
  type: "message",
  id,
  createdAt: new Date(now).toISOString(),
  message: {
    id: MessageId.make(id),
    turnId: TurnId.make("turn"),
    role: "assistant",
    text,
    streaming: true,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  },
});
const checkpoints = new Map<string, OrchestrationCheckpointSummary>();
let result: ReturnType<typeof useNativeChatPresentationMotion>;
let root: Root;
let host: HTMLDivElement;
function Feed(props: { feed: readonly ThreadFeedEntry[] }) {
  const next = useNativeChatPresentationMotion({
    threadKey: "env:thread",
    environmentId: EnvironmentId.make("env"),
    connected: true,
    ready: true,
    feed: props.feed,
    presentedFeed: props.feed,
    checkpointsByMessage: checkpoints,
  });
  useLayoutEffect(() => {
    result = next;
  });
  return null;
}
const render = (feed: readonly ThreadFeedEntry[]) => act(() => root.render(<Feed feed={feed} />));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  native.generation = 1;
  native.focused = true;
  presentation = resolveChatPresentation({
    mode: "better-t3",
    presentationMotion: true,
    characterStreamingMotion: false,
    reducedMotion: false,
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the disabled context stable while Current and Classic receive streamed tokens", () => {
  for (const mode of ["current", "classic"] as const) {
    presentation = resolveChatPresentation({
      mode,
      presentationMotion: true,
      characterStreamingMotion: false,
      reducedMotion: false,
    });
    render([message("answer", "First")]);
    const first = result.motion;
    render([message("answer", "First and second tokens")]);
    expect(result.motion).toBe(first);
    expect(result.motion.claim("surface:answer", now)).toBeNull();
  }
});

it("baselines a batched reconnect generation and resumes without replaying background arrivals", () => {
  render([message("history")]);
  expect(result.motion.claim("surface:history", now)).toBeNull();
  render([message("history"), message("new")]);
  expect(result.motion.claim("surface:new", now)?.kind).toBe("surface");
  expect(result.motion.claim("new", now)).toBeNull();
  native.generation += 1;
  render([message("history"), message("new"), message("reconnected")]);
  expect(result.motion.claim("surface:reconnected", now)).toBeNull();
  act(() => {
    for (const listener of native.listeners) listener("background");
  });
  render([message("history"), message("new"), message("reconnected"), message("background")]);
  act(() => {
    for (const listener of native.listeners) listener("active");
  });
  expect(result.motion.claim("surface:background", now)).toBeNull();
  render([
    message("history"),
    message("new"),
    message("reconnected"),
    message("background"),
    message("live"),
  ]);
  expect(result.motion.claim("surface:live", now)?.kind).toBe("surface");
});
