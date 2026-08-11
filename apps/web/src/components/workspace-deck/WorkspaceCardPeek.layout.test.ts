import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const indexCssPath = decodeURIComponent(new URL("../../index.css", import.meta.url).pathname);
const readIndexCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(indexCssPath);
}).pipe(Effect.provide(NodeServices.layer));

describe("workspace card peek layout", () => {
  it.effect("anchors Git checkout controls to the left and right card edges", () =>
    Effect.gen(function* () {
      const css = yield* readIndexCss;

      expect(css).toMatch(
        /\.workspace-card-deck__peek \.chat-composer-context-strip\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*margin-inline:\s*0;[^}]*padding-inline:\s*0\.75rem;/,
      );
      expect(css).not.toMatch(
        /\.workspace-card-deck__peek \.chat-composer-context-strip > div\s*\{[^}]*display:\s*grid;/,
      );
    }),
  );
});
