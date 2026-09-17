import { describe, expect, it } from "@effect/vitest";
import { readableGitLabJobTrace } from "./gitLabJobTrace.ts";

describe("readableGitLabJobTrace", () => {
  it("keeps labels while removing runner sections and terminal commands", () => {
    expect(
      readableGitLabJobTrace(
        "\u001b[0Ksection_start:123:build[collapsed=true]\r\u001b[0KBuild\r\n\u001b[32mOK\u001b[0m\nsection_end:124:build\r\u001b[0K",
      ),
    ).toBe("Build\nOK\n");
  });
  it("retains literal markup and normalizes progress lines", () => {
    expect(readableGitLabJobTrace("<script>alert(1)</script>\rnext\r\n")).toBe(
      "<script>alert(1)</script>\nnext\n",
    );
  });
});
