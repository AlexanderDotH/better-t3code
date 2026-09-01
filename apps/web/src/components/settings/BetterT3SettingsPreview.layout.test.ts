import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const previewCssPath = decodeURIComponent(
  new URL("./BetterT3SettingsPreview.css", import.meta.url).pathname,
);

const readPreviewCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(previewCssPath);
}).pipe(Effect.provide(NodeServices.layer));

describe("Better T3 settings previews", () => {
  it.effect("uses bounded animations that settle after each setting change", () =>
    Effect.gen(function* () {
      const css = yield* readPreviewCss;

      expect(css).toContain("@keyframes better-t3-preview-enter");
      expect(css).toContain("@keyframes better-t3-preview-card-morph");
      expect(css).toContain("@keyframes better-t3-preview-stream-token");
      expect(css).not.toContain("infinite");
      expect(css).not.toContain("will-change");
    }),
  );

  it.effect("shows final preview state immediately when reduced motion is requested", () =>
    Effect.gen(function* () {
      const css = yield* readPreviewCss;

      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.better-t3-preview-animate[^}]*animation:\s*none/s,
      );
      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.better-t3-preview-stream-token[^}]*opacity:\s*1/s,
      );
    }),
  );
});
