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
  it.effect("groups the MCP identity at the left and status at the right", () =>
    Effect.gen(function* () {
      const css = yield* readCardCss;

      expect(css).toMatch(
        /\.mcp-workspace-peek \.workspace-card-deck__peek-content > \.mcp-workspace-peek__content\s*\{[^}]*display:\s*flex;/,
      );
      expect(css).toMatch(
        /\.mcp-workspace-peek__status\s*\{[^}]*margin-inline-start:\s*auto;[^}]*max-width:\s*50%;/,
      );
      expect(css).not.toMatch(/\.mcp-workspace-peek__provider\s*\{[^}]*justify-self:\s*center;/);
    }),
  );
});
