import {
  ASSISTANT_CITATION_CONTEXT_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  type AssistantCitation,
  type EnvironmentId,
  type MessageId,
  type ThreadId,
} from "@t3tools/contracts";
import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { splitMarkdownDetails } from "./markdownDetails";
import { renderCodexInlineDirectivesAsMarkdown } from "@t3tools/shared/codexMarkdownDirectives";

const parser = unified().use(remarkParse).use(remarkGfm);

function renderedText(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "code") return `${node.value}\n`;
  if (node.type === "break") return "\n";
  if (node.type === "image") return node.alt ?? "";
  if (!("children" in node)) return "";
  const separator = node.type === "tableRow" ? " " : "";
  const text = node.children.map(renderedText).join(separator);
  return ["paragraph", "heading", "listItem", "tableRow", "blockquote"].includes(node.type)
    ? `${text}\n`
    : text;
}

export function assistantQuoteSourceText(markdown: string): string {
  const expanded = splitMarkdownDetails(markdown)
    .map((block) =>
      block.kind === "details"
        ? `${block.summary}\n${assistantQuoteSourceText(block.body)}\n`
        : block.markdown,
    )
    .join("\n");
  return renderedText(parser.parse(renderCodexInlineDirectivesAsMarkdown(expanded)))
    .replace(/\s+/g, " ")
    .trim();
}

export function buildAssistantQuote(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly markdown: string;
  readonly text: string;
  readonly start: number;
  readonly selectionMarkdown?: string;
}): AssistantCitation | null {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text || text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) return null;
  const source = assistantQuoteSourceText(input.markdown);
  const selectedBlock =
    input.selectionMarkdown === undefined
      ? null
      : assistantQuoteSourceText(input.selectionMarkdown);
  const blockStart = selectedBlock ? source.indexOf(selectedBlock) : -1;
  const expectedStart = blockStart >= 0 ? blockStart + input.start : input.start;
  let start = source.indexOf(text);
  if (start === -1) return null;
  for (
    let next = source.indexOf(text, start + 1);
    next !== -1;
    next = source.indexOf(text, next + 1)
  ) {
    if (Math.abs(next - expectedStart) < Math.abs(start - expectedStart)) start = next;
  }
  const end = start + text.length;
  return {
    version: 1,
    environmentId: input.environmentId,
    threadId: input.threadId,
    messageId: input.messageId,
    text,
    start,
    end,
    prefix: source.slice(Math.max(0, start - ASSISTANT_CITATION_CONTEXT_LENGTH), start),
    suffix: source.slice(end, end + ASSISTANT_CITATION_CONTEXT_LENGTH),
  };
}
