import type { Root, RootContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { MarkdownCodeBlockRequest } from "./SelectableMarkdownText.types";

const parser = unified().use(remarkParse);

export function markdownCodeBlocks(markdown: string) {
  const blocks: Array<{
    readonly start: number;
    readonly end: number;
    readonly request: MarkdownCodeBlockRequest;
  }> = [];
  const encoder = new TextEncoder();
  const visit = (node: Root | RootContent): void => {
    if (node.type === "code") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined)
        blocks.push({
          start,
          end,
          request: {
            code: node.value,
            language: node.lang ?? undefined,
            beg: encoder.encode(markdown.slice(0, start)).length,
            end: encoder.encode(markdown.slice(0, end)).length,
          },
        });
    } else if ("children" in node) {
      for (const child of node.children) visit(child);
    }
  };
  visit(parser.parse(markdown));
  return blocks;
}
