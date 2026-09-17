import * as NodeUtil from "node:util";

/** Keep runner section labels and output, without terminal commands or section metadata. */
export function readableGitLabJobTrace(trace: string): string {
  return NodeUtil.stripVTControlCharacters(trace)
    .replace(/section_(?:start|end):\d+:[^\r\n]*\r/g, "")
    .replace(/\r\n?/g, "\n");
}
