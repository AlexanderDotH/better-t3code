import type { Nodes, Table } from "mdast";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { unified } from "unified";
import type { MarkdownCodeBlockRequest } from "./SelectableMarkdownText.types";
import { markdownCodeBlocks } from "./markdownCodeBlocks";

const parser = unified().use(remarkParse).use(remarkGfm);
type ActionBlock = { readonly start: number; readonly end: number; readonly markdown: string } & (
  | { readonly kind: "table"; readonly csv: string }
  | {
      readonly kind: "code";
      readonly request: MarkdownCodeBlockRequest;
      readonly runnable: boolean;
    }
);

function tableText(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "image") return node.alt ?? "";
  if (node.type === "break") return "\n";
  if (node.type === "html" && /^<br\s*\/?>$/i.test(node.value.trim())) return "\n";
  return "children" in node ? node.children.map(tableText).join("") : "";
}

function tableCsv(table: Table) {
  return table.children
    .map((row) =>
      row.children
        .map((cell) => {
          const text = tableText(cell);
          return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\r\n");
}

export function markdownActionBlocks(markdown: string): ReadonlyArray<ActionBlock> {
  const blocks: ActionBlock[] = markdownCodeBlocks(markdown).map((block) => {
    const source = markdown.slice(block.start, block.end);
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(source)?.[1];
    const closed =
      fence !== undefined &&
      new RegExp(`\\n {0,3}${fence[0]}{${fence.length},}[ \\t]*$`).test(source);
    return {
      ...block,
      kind: "code",
      markdown: source,
      runnable:
        closed &&
        /^(?:sh|bash|zsh|fish|shell|powershell|pwsh)$/.test(block.request.language ?? "") &&
        block.request.code.trim().length > 0 &&
        !block.request.code.trim().endsWith("\\") &&
        !/[\p{Cf}\p{Cc}]/u.test(block.request.code.replace(/[\n\r\t]/g, "")),
    };
  });
  if (!markdown.includes("|")) return blocks;
  const visit = (node: Nodes): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === "table" && start !== undefined && end !== undefined) {
      const source = markdown.slice(start, end);
      blocks.push({ kind: "table", start, end, markdown: source, csv: tableCsv(node) });
    } else if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(parser.parse(markdown));
  return blocks.sort((left, right) => left.start - right.start);
}
