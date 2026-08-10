import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const cardCssPath = decodeURIComponent(new URL("./McpWorkspaceCard.css", import.meta.url).pathname);
const readCardCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(cardCssPath);
}).pipe(Effect.provide(NodeServices.layer));

describe("MCP workspace card layout", () => {
  it.effect("positions peek labels in the same left, center, and right columns as Git", () =>
    Effect.gen(function* () {
      const css = yield* readCardCss;

      expect(css).toMatch(
        /\.mcp-workspace-peek__content\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/,
      );
      expect(css).toMatch(/\.mcp-workspace-peek__provider\s*\{[^}]*justify-self:\s*center;/);
      expect(css).toMatch(/\.mcp-workspace-peek__status\s*\{[^}]*justify-self:\s*end;/);
    }),
  );
});
