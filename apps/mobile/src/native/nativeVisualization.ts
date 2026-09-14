import { isClosedVisualizationFence } from "@t3tools/client-runtime/visualizations/model";
import type { MarkdownCodeBlockRequest } from "@t3tools/mobile-markdown-text/types";

export function isClosedNativeVisualization(
  markdown: Uint8Array,
  block: Pick<MarkdownCodeBlockRequest, "beg" | "end">,
): boolean {
  const { beg, end } = block;
  if (beg === undefined || end === undefined || beg < 0 || end < beg || end > markdown.length) {
    return false;
  }
  const decoder = new TextDecoder();
  const source = decoder.decode(markdown.subarray(beg, end));
  // MD4C ends a fenced block at its final content line, before the closing fence.
  const tail = decoder.decode(markdown.subarray(end));
  const closingLine =
    tail.match(/^\r?\n(?:[ \t]*>[ \t]?)*[ \t]*(?:`{3,}|~{3,})[ \t]*(?:\r?\n|$)/)?.[0] ?? "";
  return isClosedVisualizationFence(source + closingLine);
}
