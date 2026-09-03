import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import chatStyles from "../index.css?raw";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import ChatMarkdown from "./ChatMarkdown";
import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
} from "../hooks/useSettings";

beforeEach(() => {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    betterT3Device: {
      ...DEFAULT_CLIENT_SETTINGS.betterT3Device,
      flags: {
        ...DEFAULT_CLIENT_SETTINGS.betterT3Device.flags,
        "chat.characterStreamingMotion": true,
      },
    },
  });
});

function StreamingMarkdown({
  text,
  streamId = "assistant-message",
  animateInitialStreamChunk = false,
  cwd,
  isStreaming = true,
}: {
  text: string;
  streamId?: string;
  animateInitialStreamChunk?: boolean;
  cwd?: string;
  isStreaming?: boolean;
}) {
  return (
    <AppAtomRegistryProvider>
      <ChatMarkdown
        text={text}
        cwd={cwd}
        isStreaming={isStreaming}
        streamId={streamId}
        animateInitialStreamChunk={animateInitialStreamChunk}
        streamingMotionEnabled
      />
    </AppAtomRegistryProvider>
  );
}

function animatedCharacters(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-stream-character]"));
}

afterEach(() => {
  __resetClientSettingsPersistenceForTests();
  document.querySelector("style[data-stream-motion-test]")?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ChatMarkdown streamed-character reveal", () => {
  it("wraps only a proven appended Markdown suffix and keeps graphemes intact", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const screen = await render(<StreamingMarkdown text="**wor" />);

    expect(animatedCharacters(screen.container)).toHaveLength(0);

    await screen.rerender(<StreamingMarkdown text="**world** 👨‍👩‍👧‍👦" />);

    const characters = animatedCharacters(screen.container);
    expect(characters.map((character) => character.textContent).join("")).toBe("ld👨‍👩‍👧‍👦");
    expect(characters.at(-1)?.textContent).toBe("👨‍👩‍👧‍👦");
    expect(
      characters.flatMap((character) =>
        character.getAttributeNames().filter((name) => name.startsWith("aria-")),
      ),
    ).toHaveLength(0);
    expect(screen.container.textContent).toContain("world 👨‍👩‍👧‍👦");
    const streamedText = Array.from(
      screen.container.querySelectorAll<HTMLElement>("[data-stream-text]"),
      (run) => run.textContent,
    ).join("");
    expect(streamedText).toBe("ld 👨‍👩‍👧‍👦");
  });

  it("animates an approved initial buffered block after the stream already completed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const screen = await render(
      <StreamingMarkdown text="Buffered answer" isStreaming={false} animateInitialStreamChunk />,
    );

    expect(
      animatedCharacters(screen.container)
        .map((character) => character.textContent)
        .join(""),
    ).toBe("Bufferedanswer");

    await vi.advanceTimersByTimeAsync(160);

    expect(animatedCharacters(screen.container)).toHaveLength(0);
    expect(screen.container.textContent).toContain("Buffered answer");
  });

  it("uses a shorter duration for a larger batch than for a single grapheme", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const screen = await render(<StreamingMarkdown text="seed" streamId="single" />);

    now.mockReturnValue(100);
    await screen.rerender(<StreamingMarkdown text="seed!" streamId="single" />);
    const singleCharacter = animatedCharacters(screen.container)[0];
    expect(singleCharacter).toBeDefined();
    const singleDuration = Number.parseFloat(
      singleCharacter?.style.getPropertyValue("--stream-character-duration") ?? "",
    );

    now.mockReturnValue(200);
    await screen.rerender(<StreamingMarkdown text="seed" streamId="batch" />);
    now.mockReturnValue(300);
    await screen.rerender(<StreamingMarkdown text="seed123456789" streamId="batch" />);
    const batchCharacters = animatedCharacters(screen.container);
    expect(batchCharacters.map((character) => character.textContent).join("")).toBe("123456789");
    const batchDuration = Number.parseFloat(
      batchCharacters[0]?.style.getPropertyValue("--stream-character-duration") ?? "",
    );

    expect(batchDuration).toBeLessThan(singleDuration);
    const finalBatchDelay = Number.parseFloat(
      batchCharacters.at(-1)?.style.getPropertyValue("--stream-character-delay") ?? "",
    );
    expect(batchDuration + finalBatchDelay).toBeLessThanOrEqual(160);

    await screen.rerender(
      <StreamingMarkdown text="seed123456789" streamId="batch" isStreaming={false} />,
    );
    expect(
      screen.container.querySelectorAll(
        "[data-stream-text], [data-stream-word], [data-stream-character]",
      ),
    ).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds an oversized append to its newest 512 characters", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const screen = await render(<StreamingMarkdown text="seed" />);
    const skippedPrefix = "a".repeat(8);
    const boundedTail = "b".repeat(512);

    await screen.rerender(<StreamingMarkdown text={`seed${skippedPrefix}${boundedTail}`} />);

    const characters = animatedCharacters(screen.container);
    expect(characters).toHaveLength(512);
    expect(characters.map((character) => character.textContent).join("")).toBe(boundedTail);
  });

  it("renders non-Classic streaming updates without motion wrappers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const screen = await render(
      <ChatMarkdown text="seed" cwd={undefined} isStreaming streamId="current-message" />,
      { wrapper: AppAtomRegistryProvider },
    );

    await screen.rerender(
      <ChatMarkdown text="seed!" cwd={undefined} isStreaming streamId="current-message" />,
    );

    expect(
      screen.container.querySelectorAll(
        "[data-stream-text], [data-stream-word], [data-stream-character]",
      ),
    ).toHaveLength(0);
    expect(screen.container.textContent).toContain("seed!");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a retained list character mounted when the next provider chunk arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const screen = await render(<StreamingMarkdown text="1. seed" />);

    now.mockReturnValue(1_000);
    await screen.rerender(<StreamingMarkdown text="1. seed!" />);
    const retainedCharacter = animatedCharacters(screen.container)[0];
    expect(retainedCharacter).toBeDefined();

    now.mockReturnValue(1_001);
    await screen.rerender(<StreamingMarkdown text="1. seed!?" />);

    expect(animatedCharacters(screen.container)[0]).toBe(retainedCharacter);
  });

  it("applies the production keyframe and removes all motion under reduced motion", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const motionStart = chatStyles.indexOf("@keyframes stream-character-reveal");
    const motionEnd = chatStyles.indexOf(".chat-markdown > :first-child", motionStart);
    expect(motionStart).toBeGreaterThanOrEqual(0);
    expect(motionEnd).toBeGreaterThan(motionStart);

    const style = document.createElement("style");
    style.dataset.streamMotionTest = "";
    style.textContent = chatStyles.slice(motionStart, motionEnd);
    document.head.append(style);
    const mediaRule = Array.from(style.sheet?.cssRules ?? []).find(
      (rule): rule is CSSMediaRule => rule instanceof CSSMediaRule,
    );
    expect(mediaRule).toBeDefined();
    mediaRule!.media.mediaText = "not all";

    const screen = await render(<StreamingMarkdown text="seed" />);
    await screen.rerender(<StreamingMarkdown text="seed!" />);
    const character = animatedCharacters(screen.container)[0];
    expect(character).toBeDefined();

    const keyframesRule = Array.from(style.sheet?.cssRules ?? []).find(
      (rule): rule is CSSKeyframesRule =>
        rule instanceof CSSKeyframesRule && rule.name === "stream-character-reveal",
    );
    expect(keyframesRule?.cssRules[0]?.style.opacity).toBe("0");
    expect(keyframesRule?.cssRules[0]?.style.transform).toBe("translateY(0.22em)");
    expect(getComputedStyle(character!).animationName).toBe("stream-character-reveal");
    expect(getComputedStyle(character!).animationTimingFunction).toBe(
      "cubic-bezier(0.22, 1, 0.36, 1)",
    );
    expect(getComputedStyle(character!).animationFillMode).toBe("backwards");
    expect(getComputedStyle(character!).willChange).toBe("auto");

    mediaRule!.media.mediaText = "all";
    expect(getComputedStyle(character!).animationName).toBe("none");
    expect(getComputedStyle(character!).opacity).toBe("1");
    expect(getComputedStyle(character!).transform).toBe("none");
  });

  it("animates appended sanitized preformatted HTML outside fenced code", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const screen = await render(<StreamingMarkdown text={"<pre>old</pre>\n"} />);

    await screen.rerender(<StreamingMarkdown text={"<pre>old</pre>\n<pre>new</pre>"} />);

    expect(animatedCharacters(screen.container).map((character) => character.textContent)).toEqual([
      "n",
      "e",
      "w",
    ]);
  });

  it("animates newly materialized file-chip and fence-title labels without their icons", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const screen = await render(<StreamingMarkdown text="" cwd="/workspace" />);

    await screen.rerender(
      <StreamingMarkdown
        text={'[example](src/example.ts)\n\n```ts title="example.ts"\n'}
        cwd="/workspace"
      />,
    );

    const fileLabel = screen.container.querySelector<HTMLElement>(
      ".chat-markdown-file-link [data-stream-text]",
    );
    const fenceTitle = screen.container.querySelector<HTMLElement>(
      ".chat-markdown-codeblock-title [data-stream-text]",
    );
    expect(fileLabel?.textContent).toContain("example.ts");
    expect(fenceTitle?.textContent).toBe("example.ts");
    expect(screen.container.querySelectorAll("svg[data-stream-character]")).toHaveLength(0);
  });

  it("animates only appended Shiki token graphemes after the highlighter is warm", async () => {
    const screen = await render(
      <ChatMarkdown text={"```ts\nconst warmed = true\n```"} cwd={undefined} />,
      { wrapper: AppAtomRegistryProvider },
    );
    await vi.waitFor(() => {
      expect(screen.container.querySelector(".chat-markdown-shiki")).not.toBeNull();
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    await screen.rerender(<StreamingMarkdown text={"```ts\nconst value = "} streamId="code" />);
    await screen.rerender(<StreamingMarkdown text={"```ts\nconst value = 1"} streamId="code" />);
    await screen.rerender(<StreamingMarkdown text={"```ts\nconst value = 12"} streamId="code" />);

    const shikiCharacters = Array.from(
      screen.container.querySelectorAll<HTMLElement>(
        ".chat-markdown-shiki [data-stream-character]",
      ),
    );
    expect(shikiCharacters.map((character) => character.textContent).join("")).toBe("12");
    expect(screen.container.querySelector(".chat-markdown-shiki")?.textContent).toContain(
      "const value = 12",
    );
  });
});
