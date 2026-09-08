import type { ServerProviderSkill } from "@t3tools/contracts";
import type { ShikiTransformer } from "@pierre/diffs";
import React, {
  Children,
  cloneElement,
  isValidElement,
  useContext,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { renderSkillInlineMarkdownChildren } from "./SkillInlineText";
import {
  getStreamingTextMotionAnimationTiming,
  mapSourceFrameToRenderedText,
  segmentStreamingTextGraphemes,
  type RenderedStreamingTextRange,
  type StreamingTextGrapheme,
  type StreamingTextMotionFrame,
} from "./streamingTextMotion";

const EMPTY_MARKDOWN_SKILLS: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [];
const STREAM_TEXT_TAG_NAME = "stream-text";
const STREAMING_WORD_WRAP_GRAPHEME_LIMIT = 24;
const STREAMING_SKILL_TOKEN_PATTERN = /^[$/]([a-zA-Z][a-zA-Z0-9:_-]*)$/;

interface ChatMarkdownHastPoint {
  readonly offset?: number | undefined;
}

interface ChatMarkdownHastPosition {
  readonly start: ChatMarkdownHastPoint;
  readonly end: ChatMarkdownHastPoint;
}

export interface ChatMarkdownHastNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: ChatMarkdownHastNode[];
  position?: ChatMarkdownHastPosition | undefined;
}

interface SourceRange {
  readonly start: number;
  readonly end: number;
}

interface StreamingRehypeOptions {
  readonly frames: readonly StreamingTextMotionFrame[];
  readonly source: string;
}

interface FramedRenderedStreamingTextRange extends RenderedStreamingTextRange {
  readonly frame: StreamingTextMotionFrame;
}

interface StreamingTextNodeProps {
  readonly node?: ChatMarkdownHastNode | undefined;
  readonly children?: ReactNode | undefined;
}

interface StreamingTextRunProps {
  readonly animationTimeMs: number;
  readonly frame: StreamingTextMotionFrame;
  readonly graphemeIndexStart: number;
  readonly skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  readonly sourceStart: number;
  readonly text: string;
}

export interface StreamingLabelMotion {
  readonly animationTimeMs: number;
  readonly frame: StreamingTextMotionFrame;
  readonly graphemeIndexStart: number;
  readonly sourceStart: number;
}

export interface StreamingTextRenderContextValue {
  readonly animationTimeMs: number;
  readonly framesByGeneration: ReadonlyMap<number, StreamingTextMotionFrame>;
  readonly skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  readonly source: string;
}

export const StreamingTextRenderContext =
  React.createContext<StreamingTextRenderContextValue | null>(null);

type StreamingCharacterStyle = CSSProperties & {
  readonly "--stream-character-delay": string;
  readonly "--stream-character-duration": string;
};

/**
 * Runs after sanitization, so the custom node can only carry text that already
 * passed through the normal Markdown safety boundary. Fenced code stays on its
 * own Shiki path because token offsets are the only reliable rendered mapping
 * once syntax highlighting changes the text-node structure.
 */
export function rehypeMarkStreamingText({ frames, source }: StreamingRehypeOptions) {
  return (tree: ChatMarkdownHastNode) => {
    const visit = (node: ChatMarkdownHastNode) => {
      if (
        node.type === "element" &&
        node.tagName === "pre" &&
        node.children?.some((child) => child.type === "element" && child.tagName === "code")
      ) {
        return;
      }
      if (!node.children) {
        return;
      }

      const nextChildren: ChatMarkdownHastNode[] = [];
      for (const child of node.children) {
        if (child.type !== "text" || typeof child.value !== "string" || child.value.length === 0) {
          visit(child);
          nextChildren.push(child);
          continue;
        }

        const ranges = findStreamingRenderedRanges({
          child,
          parent: node,
          frames,
          source,
        });
        if (ranges.length === 0) {
          nextChildren.push(child);
          continue;
        }

        let renderedOffset = 0;
        for (const range of ranges) {
          const prefix = child.value.slice(renderedOffset, range.renderedStart);
          if (prefix.length > 0) {
            nextChildren.push({ ...child, value: prefix });
          }
          nextChildren.push({
            type: "element",
            tagName: STREAM_TEXT_TAG_NAME,
            properties: {
              streamGeneration: range.frame.generation,
              streamGraphemeIndexStart: range.graphemes[0]?.index ?? 0,
              streamSourceStart: range.sourceStart,
            },
            children: [{ type: "text", value: range.text }],
            ...(child.position ? { position: child.position } : {}),
          });
          renderedOffset = range.renderedEnd;
        }
        const suffix = child.value.slice(renderedOffset);
        if (suffix.length > 0) {
          nextChildren.push({ ...child, value: suffix });
        }
      }
      node.children = nextChildren;
    };

    visit(tree);
  };
}

function findStreamingRenderedRanges({
  child,
  parent,
  frames,
  source,
}: {
  readonly child: ChatMarkdownHastNode;
  readonly parent: ChatMarkdownHastNode;
  readonly frames: readonly StreamingTextMotionFrame[];
  readonly source: string;
}): readonly FramedRenderedStreamingTextRange[] {
  const renderedText = child.value;
  if (typeof renderedText !== "string") {
    return [];
  }

  const mappedRanges: FramedRenderedStreamingTextRange[] = [];
  const sourceRanges = renderedTextSourceRanges(source, renderedText, child, parent);
  const firstFrame = frames[0];
  const lastFrame = frames.at(-1);
  if (
    firstFrame === undefined ||
    lastFrame === undefined ||
    sourceRanges.every(
      (range) => range.end <= firstFrame.sourceStart || range.start >= lastFrame.sourceEnd,
    )
  ) {
    return [];
  }
  for (const frame of frames) {
    for (const range of sourceRanges) {
      if (frame.sourceEnd <= range.start || frame.sourceStart >= range.end) continue;
      const mapped = mapSourceFrameToRenderedText({
        frame,
        source,
        sourceStart: range.start,
        sourceEnd: range.end,
        renderedText,
      });
      if (mapped !== null) {
        mappedRanges.push({ ...mapped, frame });
        break;
      }
    }
  }
  mappedRanges.sort((left, right) => left.renderedStart - right.renderedStart);

  const disjointRanges: FramedRenderedStreamingTextRange[] = [];
  for (const range of mappedRanges) {
    if (range.renderedStart < (disjointRanges.at(-1)?.renderedEnd ?? 0)) {
      continue;
    }
    disjointRanges.push(range);
  }
  return disjointRanges;
}

function renderedTextSourceRanges(
  source: string,
  renderedText: string,
  node: ChatMarkdownHastNode,
  parent: ChatMarkdownHastNode,
): readonly SourceRange[] {
  const ranges: SourceRange[] = [];
  const directRange = readNodeSourceRange(node);
  if (directRange) {
    ranges.push(directRange);
    pushExactRenderedTextRange(ranges, source, renderedText, directRange);
  }

  const parentRange = readNodeSourceRange(parent);
  if (parentRange) {
    pushExactRenderedTextRange(ranges, source, renderedText, parentRange);
  }
  return uniqueSourceRanges(ranges);
}

function readNodeSourceRange(node: ChatMarkdownHastNode): SourceRange | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start === undefined ||
    end === undefined
  ) {
    return null;
  }
  return start >= 0 && start < end ? { start, end } : null;
}

function pushExactRenderedTextRange(
  ranges: SourceRange[],
  source: string,
  renderedText: string,
  container: SourceRange,
): void {
  const containerText = source.slice(container.start, container.end);
  const relativeStart = containerText.indexOf(renderedText);
  if (relativeStart < 0 || relativeStart !== containerText.lastIndexOf(renderedText)) {
    return;
  }
  const start = container.start + relativeStart;
  ranges.push({ start, end: start + renderedText.length });
}

function uniqueSourceRanges(ranges: readonly SourceRange[]): readonly SourceRange[] {
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.start}:${range.end}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function StreamingTextRun({
  animationTimeMs,
  frame,
  graphemeIndexStart,
  skills,
  sourceStart,
  text,
}: StreamingTextRunProps) {
  const graphemes = segmentStreamingTextGraphemes(text, sourceStart);
  const groups = groupStreamingTextGraphemes(graphemes);
  return (
    <span data-stream-text="" data-stream-generation={frame.generation}>
      {groups.map((group) => {
        const groupKey = `${frame.generation}:${group[0]?.sourceOffset ?? sourceStart}`;
        const groupText = group.map((grapheme) => grapheme.text).join("");
        if (group.every(isWhitespaceGrapheme)) {
          return <React.Fragment key={groupKey}>{groupText}</React.Fragment>;
        }
        if (isKnownSkillToken(groupText, skills)) {
          return (
            <React.Fragment key={groupKey}>
              {renderSkillInlineMarkdownChildren(groupText, skills)}
            </React.Fragment>
          );
        }

        const characters = group.map((grapheme) => (
          <StreamingCharacter
            key={`${frame.generation}:${grapheme.sourceOffset}:${grapheme.text}`}
            animationTimeMs={animationTimeMs}
            frame={frame}
            grapheme={grapheme}
            graphemeIndex={graphemeIndexStart + grapheme.index}
          />
        ));
        if (group.length <= STREAMING_WORD_WRAP_GRAPHEME_LIMIT) {
          return (
            <span key={groupKey} className="inline-block" data-stream-word="">
              {characters}
            </span>
          );
        }
        return <React.Fragment key={groupKey}>{characters}</React.Fragment>;
      })}
    </span>
  );
}

export function StreamingTextNode({ node, children }: StreamingTextNodeProps) {
  const renderContext = useContext(StreamingTextRenderContext);
  const generation = node?.properties?.streamGeneration;
  const sourceStart = node?.properties?.streamSourceStart;
  const graphemeIndexStart = node?.properties?.streamGraphemeIndexStart;
  const streamedText = nodeToPlainText(children);
  const frame =
    renderContext !== null && typeof generation === "number"
      ? renderContext.framesByGeneration.get(generation)
      : undefined;
  if (
    renderContext === null ||
    !frame ||
    typeof sourceStart !== "number" ||
    typeof graphemeIndexStart !== "number" ||
    streamedText.length === 0
  ) {
    return <>{children}</>;
  }
  return (
    <StreamingTextRun
      animationTimeMs={renderContext.animationTimeMs}
      frame={frame}
      graphemeIndexStart={graphemeIndexStart}
      skills={renderContext.skills}
      sourceStart={sourceStart}
      text={streamedText}
    />
  );
}

export function StreamingLabelText({
  motion,
  text,
}: {
  readonly motion: StreamingLabelMotion | null | undefined;
  readonly text: string;
}) {
  if (!motion) {
    return <>{text}</>;
  }
  return (
    <StreamingTextRun
      animationTimeMs={motion.animationTimeMs}
      frame={motion.frame}
      graphemeIndexStart={motion.graphemeIndexStart}
      skills={EMPTY_MARKDOWN_SKILLS}
      sourceStart={motion.sourceStart}
      text={text}
    />
  );
}

export function resolveMaterializedLabelMotion({
  animationTimeMs,
  frames,
  node,
  source,
}: {
  readonly animationTimeMs: number;
  readonly frames: readonly StreamingTextMotionFrame[];
  readonly node: ChatMarkdownHastNode;
  readonly source: string;
}): StreamingLabelMotion | null {
  const range = readNodeSourceRange(node);
  if (!range) {
    return null;
  }
  const frame = frames.find(
    (candidate) => range.start >= candidate.sourceStart && range.end <= candidate.sourceEnd,
  );
  if (!frame) return null;
  return {
    animationTimeMs,
    frame,
    graphemeIndexStart: segmentStreamingTextGraphemes(source.slice(frame.sourceStart, range.start))
      .length,
    sourceStart: range.start,
  };
}

function StreamingCharacter({
  animationTimeMs,
  frame,
  grapheme,
  graphemeIndex,
}: {
  readonly animationTimeMs: number;
  readonly frame: StreamingTextMotionFrame;
  readonly grapheme: StreamingTextGrapheme;
  readonly graphemeIndex: number;
}) {
  // A retained span must keep the CSS timeline it mounted with. Rewriting
  // animation-delay on every provider chunk makes browsers restart the fade.
  const [animationTiming] = useState(() =>
    getStreamingTextMotionAnimationTiming(frame, graphemeIndex, animationTimeMs),
  );
  const style: StreamingCharacterStyle = {
    "--stream-character-delay": `${animationTiming.delayMs}ms`,
    "--stream-character-duration": `${animationTiming.durationMs}ms`,
  };
  return (
    <span
      data-stream-character=""
      data-stream-generation={frame.generation}
      data-stream-source-offset={grapheme.sourceOffset}
      style={style}
    >
      {grapheme.text}
    </span>
  );
}

function groupStreamingTextGraphemes(
  graphemes: readonly StreamingTextGrapheme[],
): readonly (readonly StreamingTextGrapheme[])[] {
  const groups: StreamingTextGrapheme[][] = [];
  for (const grapheme of graphemes) {
    const previous = groups.at(-1);
    if (previous && isWhitespaceGrapheme(previous[0]) === isWhitespaceGrapheme(grapheme)) {
      previous.push(grapheme);
      continue;
    }
    groups.push([grapheme]);
  }
  return groups;
}

function isWhitespaceGrapheme(grapheme: StreamingTextGrapheme | undefined): boolean {
  return grapheme !== undefined && /^\s+$/u.test(grapheme.text);
}

function isKnownSkillToken(
  text: string,
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>,
): boolean {
  const name = STREAMING_SKILL_TOKEN_PATTERN.exec(text)?.[1];
  return name !== undefined && skills.some((skill) => skill.name === name);
}

export function renderSkillAwareMarkdownChildren(
  children: ReactNode,
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>,
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return renderSkillInlineMarkdownChildren(child, skills);
    }
    if (!isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child)) {
      return child;
    }
    const markdownTagName = typeof child.type === "string" ? child.type : child.props.node?.tagName;
    if (
      markdownTagName === STREAM_TEXT_TAG_NAME ||
      markdownTagName === "code" ||
      markdownTagName === "a" ||
      !("children" in child.props)
    ) {
      return child;
    }
    return cloneElement(
      child,
      undefined,
      renderSkillAwareMarkdownChildren(child.props.children, skills),
    );
  });
}

export function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

export function createStreamingCodeTransformer({
  animationTimeMs,
  codeSourceStart,
  frames,
  source,
}: {
  readonly animationTimeMs: number;
  readonly codeSourceStart: number;
  readonly frames: readonly StreamingTextMotionFrame[];
  readonly source: string;
}): ShikiTransformer {
  return {
    name: "t3-streaming-text-motion",
    span(hast, _line, _column, _lineElement, token) {
      const tokenSourceStart = codeSourceStart + token.offset;
      const tokenSourceEnd = tokenSourceStart + token.content.length;
      const ranges: FramedRenderedStreamingTextRange[] = [];
      for (const frame of frames) {
        if (frame.sourceEnd <= tokenSourceStart) continue;
        if (frame.sourceStart >= tokenSourceEnd) break;
        const range = mapSourceFrameToRenderedText({
          frame,
          source,
          sourceStart: tokenSourceStart,
          sourceEnd: tokenSourceEnd,
          renderedText: token.content,
        });
        if (range !== null) ranges.push({ ...range, frame });
      }
      ranges.sort((left, right) => left.renderedStart - right.renderedStart);
      if (ranges.length === 0) {
        return;
      }

      const children: typeof hast.children = [];
      let renderedOffset = 0;
      for (const range of ranges) {
        if (range.renderedStart < renderedOffset) continue;
        const prefix = token.content.slice(renderedOffset, range.renderedStart);
        if (prefix.length > 0) {
          children.push({ type: "text", value: prefix });
        }
        for (const grapheme of range.graphemes) {
          const animationTiming = getStreamingTextMotionAnimationTiming(
            range.frame,
            grapheme.index,
            animationTimeMs,
          );
          children.push({
            type: "element",
            tagName: "span",
            properties: {
              "data-stream-character": "",
              "data-stream-generation": String(range.frame.generation),
              "data-stream-source-offset": String(grapheme.sourceOffset),
              style: `--stream-character-delay:${animationTiming.delayMs}ms;--stream-character-duration:${animationTiming.durationMs}ms`,
            },
            children: [{ type: "text", value: grapheme.text }],
          });
        }
        renderedOffset = range.renderedEnd;
      }
      const suffix = token.content.slice(renderedOffset);
      if (suffix.length > 0) {
        children.push({ type: "text", value: suffix });
      }
      hast.children = children;
    },
  };
}

export function resolveFencedCodeSourceStart(
  source: string,
  node: ChatMarkdownHastNode,
  code: string,
): number | null {
  const blockRange = readNodeSourceRange(node);
  if (!blockRange) {
    return null;
  }
  const openingFenceEnd = source.indexOf("\n", blockRange.start);
  if (openingFenceEnd < 0 || openingFenceEnd >= blockRange.end) {
    return null;
  }
  const codeSourceStart = openingFenceEnd + 1;
  const sourceComparableCode = code.endsWith("\n") ? code.slice(0, -1) : code;
  if (!source.startsWith(sourceComparableCode, codeSourceStart)) {
    return null;
  }
  return codeSourceStart;
}
