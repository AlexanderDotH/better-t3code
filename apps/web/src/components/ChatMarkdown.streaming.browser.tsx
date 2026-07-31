import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import chatStyles from "../index.css?raw";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import ChatMarkdown from "./ChatMarkdown";

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
      />
    </AppAtomRegistryProvider>
  );
}

function animatedCharacters(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-stream-character]"));
}

afterEach(() => {
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

  it("adapts inline timing without ever creating more than 160 transient nodes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const screen = await render(<StreamingMarkdown text="seed" />);

    now.mockReturnValue(1_000);
    await screen.rerender(<StreamingMarkdown text="seed!" />);
    const slowCharacter = animatedCharacters(screen.container)[0];
    expect(slowCharacter).toBeDefined();
    const slowDuration = Number.parseFloat(
      slowCharacter?.style.getPropertyValue("--stream-character-duration") ?? "",
    );

    now.mockReturnValue(1_001);
    await screen.rerender(<StreamingMarkdown text="seed!?" />);
    const fastCharacter = animatedCharacters(screen.container)[0];
    expect(fastCharacter).toBeDefined();
    const fastDuration = Number.parseFloat(
      fastCharacter?.style.getPropertyValue("--stream-character-duration") ?? "",
    );

    expect(fastDuration).toBeLessThan(slowDuration);
    const fastDelay = Number.parseFloat(
      fastCharacter?.style.getPropertyValue("--stream-character-delay") ?? "",
    );
    expect(fastDuration + fastDelay).toBeLessThanOrEqual(160);

    await screen.rerender(<StreamingMarkdown text="seed!?" isStreaming={false} />);
    expect(
      screen.container.querySelectorAll(
        "[data-stream-text], [data-stream-word], [data-stream-character]",
      ),
    ).toHaveLength(0);

    now.mockReturnValue(2_000);
    await screen.rerender(<StreamingMarkdown text={`seed!?${"x".repeat(161)}`} />);
    expect(animatedCharacters(screen.container)).toHaveLength(0);
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
    expect(keyframesRule?.cssRules[0]?.style.opacity).toBe("0.08");
    expect(keyframesRule?.cssRules[0]?.style.transform).toBe("translate3d(0px, 0.22em, 0px)");
    expect(getComputedStyle(character!).animationName).toBe("stream-character-reveal");
    expect(getComputedStyle(character!).animationTimingFunction).toBe(
      "cubic-bezier(0.22, 1, 0.36, 1)",
    );

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

    const shikiCharacters = Array.from(
      screen.container.querySelectorAll<HTMLElement>(
        ".chat-markdown-shiki [data-stream-character]",
      ),
    );
    expect(shikiCharacters.map((character) => character.textContent).join("")).toBe("1");
    expect(screen.container.querySelector(".chat-markdown-shiki")?.textContent).toContain(
      "const value = 1",
    );
  });
});
