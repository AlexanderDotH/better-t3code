import { describe, expect, it } from "vite-plus/test";
import { markdownActionBlocks } from "./markdownActionBlocks";

describe("Markdown block actions", () => {
  it("copies table values as CSV with escaped delimiters and rendered link labels", () => {
    const markdown =
      'Before\n\n| Name | Value |\n| --- | --- |\n| **a,b** | say "hello" |\n| [link](https://example.com) | `a\\|b` |\n\nAfter';
    const [table] = markdownActionBlocks(markdown);
    expect(table?.kind).toBe("table");
    expect(table?.kind === "table" && table.csv).toBe(
      'Name,Value\r\n"a,b","say ""hello"""\r\nlink,a|b',
    );
    expect(markdown.slice(table!.start, table!.end)).toBe(table!.markdown);
    const [multiline] = markdownActionBlocks("| Name |\n| --- |\n| first<br>second |");
    expect(multiline?.kind === "table" && multiline.csv).toBe('Name\r\n"first\nsecond"');
  });

  it("offers terminal actions only for complete shell fences without hidden controls", () => {
    const runnable = (markdown: string) =>
      markdownActionBlocks(markdown).some((block) => block.kind === "code" && block.runnable);
    expect(runnable("```bash\necho ok\n```")).toBe(true);
    expect(runnable("~~~sh\necho ok\n~~~")).toBe(true);
    expect(runnable("```bash\necho incomplete")).toBe(false);
    expect(runnable("```ts\nconsole.log(1)\n```")).toBe(false);
    expect(runnable(["```sh", "echo \\", "```"].join("\n"))).toBe(false);
    expect(runnable("```sh\necho \u202Ehidden\n```")).toBe(false);
  });
});
