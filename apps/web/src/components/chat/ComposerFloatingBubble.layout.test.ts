import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const bubbleCssPath = decodeURIComponent(
  new URL("./ComposerFloatingBubble.css", import.meta.url).pathname,
);

const readBubbleCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(bubbleCssPath);
}).pipe(Effect.provide(NodeServices.layer));

describe("ComposerFloatingBubble layout", () => {
  it.effect("uses one rounded body with internal separators above the three-card deck", () =>
    Effect.gen(function* () {
      const css = yield* readBubbleCss;

      expect(css).toMatch(
        /\.composer-floating-bubble-region\s*\{[^}]*padding-block-end:\s*0\.75rem;/s,
      );
      expect(css).toMatch(
        /\.composer-floating-bubble-host\s*\{[^}]*width:\s*calc\(100% - 2\.75rem\);[^}]*gap:\s*0;[^}]*border-radius:\s*1rem;/s,
      );
      expect(css).toMatch(
        /\.composer-floating-bubble-host\s*>\s*\[data-slot="composer-banner-attachment"\]\s*\{[^}]*width:\s*100%;[^}]*margin:\s*0;/s,
      );
      expect(css).toMatch(
        /\.composer-floating-bubble-host\s*>\s*\[data-slot="composer-banner-attachment"\]\s*\+\s*\[data-slot="composer-banner-attachment"\]\s*\{[^}]*border-block-start:/s,
      );
    }),
  );

  it.effect("uses one bounded entrance and settles without recurring work", () =>
    Effect.gen(function* () {
      const css = yield* readBubbleCss;

      expect(css).toMatch(
        /\.composer-floating-bubble-host:not\(:empty\)\s*\{[^}]*animation:\s*composer-floating-bubble-enter 180ms/s,
      );
      expect(css).toContain("@keyframes composer-floating-bubble-enter");
      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.composer-floating-bubble-host:not\(:empty\)\s*\{[^}]*animation:\s*none;/s,
      );
      expect(css).not.toContain("infinite");
      expect(css).not.toContain("will-change");
    }),
  );
});
