import type { ReactElement } from "react";
import type { Root, RootContent } from "hast";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";
import { renderSkillInlineMarkdownChildren } from "./SkillInlineText";
import {
  applyStreamingCodeMotion,
  resolveFencedCodeSourceStart,
  resolveMaterializedLabelMotion,
  StreamingTextNode,
  StreamingTextRenderContext,
} from "./streamingMarkdown";
import type { StreamingTextMotionFrame } from "./streamingTextMotion";

const frame: StreamingTextMotionFrame = {
  generation: 1,
  startedAtMs: 0,
  sourceStart: 0,
  sourceEnd: 20,
  graphemeCount: 3,
  smoothedRate: 20,
  durationMs: 200,
  staggerWindowMs: 100,
  staggerStepMs: 10,
  revealDeadlineMs: 300,
};

async function renderNode(node: ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(node);
  });
  return {
    renderer,
    async [Symbol.asyncDispose]() {
      await act(() => renderer.unmount());
    },
  };
}

function codeText(node: Root | RootContent): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(codeText).join("") : "";
}

describe("streaming markdown integration", () => {
  it("keeps raw stream text through the skill renderer so complete graphemes animate", async () => {
    const text = "A 👩‍💻";
    const children = renderSkillInlineMarkdownChildren(
      <StreamingTextNode
        node={{
          tagName: "stream-text",
          properties: {
            streamGeneration: 1,
            streamGraphemeIndexStart: 0,
            streamSourceStart: 0,
          },
        }}
      >
        {text}
      </StreamingTextNode>,
      [],
      undefined,
    );
    await using screen = await renderNode(
      <StreamingTextRenderContext
        value={{
          animationTimeMs: 20,
          framesByGeneration: new Map([[1, frame]]),
          skills: [],
          source: text,
        }}
      >
        <p>{children}</p>
      </StreamingTextRenderContext>,
    );
    const characters = screen.renderer.root.findAll(
      (node) => node.type === "span" && Object.hasOwn(node.props, "data-stream-character"),
    );
    expect(characters.map((node) => node.children.join(""))).toEqual(["A", "👩‍💻"]);
    expect(characters.map((node) => node.props["data-stream-source-offset"])).toEqual([0, 2]);
  });

  it("animates appended highlighted tokens without changing cached completed lines or source text", () => {
    const root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: {},
              children: [
                {
                  type: "element",
                  tagName: "span",
                  properties: { className: ["line"] },
                  children: [{ type: "text", value: "keep" }],
                },
                { type: "text", value: "\n" },
                {
                  type: "element",
                  tagName: "span",
                  properties: { className: ["line"] },
                  children: [
                    {
                      type: "element",
                      tagName: "span",
                      properties: {},
                      children: [{ type: "text", value: "new" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } satisfies Parameters<typeof applyStreamingCodeMotion>[0];
    const animated = applyStreamingCodeMotion(root, {
      source: "```ts\nkeep\nnew\n```",
      codeSourceStart: 6,
      animationTimeMs: 20,
      frames: [{ ...frame, sourceStart: 11, sourceEnd: 14 }],
    });
    const before = root.children[0]!.children[0]!.children;
    const pre = animated.children[0];
    const code = pre?.type === "element" ? pre.children[0] : undefined;
    const after = code?.type === "element" ? code.children : [];
    expect(after[0]).toBe(before[0]);
    expect(codeText(animated)).toBe("keep\nnew");
    expect(after[2]).not.toBe(before[2]);
    expect(JSON.stringify(after[2])).toContain("data-stream-character");
    expect(JSON.stringify(before[2])).not.toContain("data-stream-character");
    expect(
      applyStreamingCodeMotion(root, {
        source: "",
        codeSourceStart: 6,
        animationTimeMs: 20,
        frames: [],
      }),
    ).toBe(root);
  });

  it("maps only matching fences and newly materialized label ranges", () => {
    const source = "```ts\nnew\n```";
    const node = { position: { start: { offset: 0 }, end: { offset: source.length } } };
    expect(resolveFencedCodeSourceStart(source, node, "new\n")).toBe(6);
    expect(resolveFencedCodeSourceStart(source, node, "other\n")).toBeNull();
    expect(resolveFencedCodeSourceStart(source, {}, "new\n")).toBeNull();
    expect(
      resolveMaterializedLabelMotion({ animationTimeMs: 20, frames: [frame], node, source })
        ?.sourceStart,
    ).toBe(0);
    expect(
      resolveMaterializedLabelMotion({
        animationTimeMs: 20,
        frames: [{ ...frame, sourceStart: 5 }],
        node,
        source,
      }),
    ).toBeNull();
  });
});
