import { describe, expect, it } from "vite-plus/test";
import { isClosedNativeVisualization } from "./nativeVisualization";

const encode = (value: string) => new TextEncoder().encode(value);

describe("native visualization fences", () => {
  it("uses MD4C byte offsets and includes its excluded closing line", () => {
    // These offsets come from the bundled MD4C parser, including a multibyte prefix.
    const source = encode("ü😀\n```mermaid\ngraph TD;A-->B\n```\n");
    expect(isClosedNativeVisualization(source, { beg: 7, end: 32 })).toBe(true);
  });

  it("keeps an unfinished block as code even if another matching block is complete", () => {
    const complete = "```mermaid\ngraph TD;A-->B\n```\n";
    const incomplete = "```mermaid\ngraph TD;A-->B";
    const source = encode(complete + incomplete);
    expect(
      isClosedNativeVisualization(source, { beg: encode(complete).length, end: source.length }),
    ).toBe(false);
    expect(isClosedNativeVisualization(source, {})).toBe(false);
  });

  it("requires the opening fence character and length, including CRLF and quoted blocks", () => {
    for (const [opening, closing, expected] of [
      ["~~~~mermaid", "~~~", false],
      ["~~~mermaid", "```", false],
      ["~~~mermaid", "~~~~", true],
      ["```mermaid", "> ```", true],
    ] as const) {
      const content = `${opening}\r\ngraph TD;A-->B`;
      expect(
        isClosedNativeVisualization(encode(`${content}\r\n${closing}\r\n`), {
          beg: 0,
          end: encode(content).length,
        }),
      ).toBe(expected);
    }
  });
});
