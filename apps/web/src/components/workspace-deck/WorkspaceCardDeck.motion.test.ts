import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const deckCssPath = decodeURIComponent(
  new URL("./WorkspaceCardDeck.css", import.meta.url).pathname,
);
const deckSourcePath = decodeURIComponent(
  new URL("./WorkspaceCardDeck.tsx", import.meta.url).pathname,
);
const readDeckCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(deckCssPath);
}).pipe(Effect.provide(NodeServices.layer));
const readDeckSource = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(deckSourcePath);
}).pipe(Effect.provide(NodeServices.layer));

describe("workspace card deck motion", () => {
  it.effect("uses equal compact dimensions with mirrored 32px peeks", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(/\.workspace-card-deck\s*\{[^}]*padding-block:\s*2rem;/);
      expect(css).toMatch(/\.workspace-card-deck__peeks\s*\{[^}]*inset-block:\s*2rem;/);
      expect(css).toMatch(
        /\.workspace-card-deck__viewport\s*\{[^}]*height:\s*var\(--workspace-card-deck-compact-height\);[^}]*transition:\s*height 200ms ease-out;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__viewport\[data-expanded="true"\]\s*\{[^}]*transition:\s*height 420ms[^;]*;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__viewport\[data-height-ready="true"\]:not\(\[data-expanded="true"\]\)\s+\.workspace-card-deck__intrinsic\s*\{[^}]*display:\s*grid;[^}]*height:\s*100%;/,
      );
      expect(css).toMatch(/\.workspace-card-deck__card\s*\{[^}]*min-height:\s*0;/);
      expect(css).toMatch(
        /\.workspace-card-deck__viewport:not\(\[data-expanded="true"\]\)\s+\.workspace-card-deck__card\s*\{[^}]*overflow:\s*clip;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__peek\s*\{[^}]*inset-inline:\s*1\.375rem;[^}]*height:\s*2rem;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__peek--previous\s*\{[^}]*inset-block-start:\s*-2rem;/,
      );
      expect(css).toMatch(/\.workspace-card-deck__peek--next\s*\{[^}]*inset-block-end:\s*-2rem;/);
      expect(css).toMatch(
        /\.workspace-card-deck__peek--previous\s*\{[^}]*box-shadow:\s*0 -12px 28px -18px/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__peek--next\s*\{[^}]*box-shadow:\s*0 12px 28px -18px/,
      );
    }),
  );

  it.effect("morphs complete card contents between directional peek and active radii", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(
        /\[data-deck-motion="morph"\][\s\S]*?\.workspace-card-deck__intrinsic\s*\{[^}]*overflow:\s*clip;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__card\[data-transition-role="incoming"\][\s\S]*?\.workspace-card-deck__intrinsic\s*\{[^}]*will-change:\s*transform, clip-path, border-radius, opacity;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__card\[data-transition-role="outgoing"\][\s\S]*?\.workspace-card-deck__intrinsic\s*\{[^}]*will-change:\s*transform, clip-path, border-radius, opacity;/,
      );
      expect(css).not.toMatch(/\.workspace-card-deck__intrinsic\s*\{[^}]*opacity:/);
      expect(css).not.toContain("rotate(");
      expect(css).not.toContain("translateX(");
    }),
  );

  it.effect("locks the deck during compact collapse without starting card transforms", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(
        /\.workspace-card-deck\[data-deck-collapsing\]\s*\{[^}]*pointer-events:\s*none;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__viewport\[data-collapsing="true"\]\s*\{[^}]*transition:\s*height 360ms[^;]*;[^}]*will-change:\s*height;/,
      );
      expect(css).not.toMatch(
        /\.workspace-card-deck\[data-deck-collapsing\][^{]*\{[^}]*animation:/,
      );
    }),
  );

  it.effect("settles the 360ms expansion exit before capturing the pending compact switch", () =>
    Effect.gen(function* () {
      const source = yield* readDeckSource;
      const finishCollapse = source.slice(
        source.indexOf("const finishCollapse"),
        source.indexOf("useIsomorphicLayoutEffect", source.indexOf("const finishCollapse")),
      );

      expect(finishCollapse.indexOf("cleanupExpansionMorph();")).toBeGreaterThan(-1);
      expect(finishCollapse.indexOf("captureMorphRequest(pendingIntent)")).toBeGreaterThan(
        finishCollapse.indexOf("cleanupExpansionMorph();"),
      );
      expect(
        finishCollapse.indexOf("collapseCompleteCallbackRef.current?.(collapsedCard)"),
      ).toBeGreaterThan(finishCollapse.indexOf("captureMorphRequest(pendingIntent)"));
    }),
  );

  it.effect("keeps the legacy carousel only as the explicit non-WAAPI fallback", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(
        /\[data-deck-motion="fallback"\]\[data-deck-transition="forward"\]\s*\{[^}]*--workspace-card-carousel-in-y:\s*100%;[^}]*--workspace-card-carousel-out-y:\s*-100%;/,
      );
      expect(css).toMatch(
        /\[data-deck-motion="fallback"\]\[data-deck-transition="backward"\]\s*\{[^}]*--workspace-card-carousel-in-y:\s*-100%;[^}]*--workspace-card-carousel-out-y:\s*100%;/,
      );
      expect(css).toMatch(/workspace-card-carousel-in 420ms[^;]*both/);
      expect(css).toMatch(/workspace-card-carousel-out 420ms[^;]*both/);
    }),
  );

  it.effect("reveals the reordered back peek only at its destination edge", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(/\.workspace-card-deck__peeks\s*\{[^}]*z-index:\s*1;/);
      expect(css).toMatch(/\.workspace-card-deck__viewport\s*\{[^}]*z-index:\s*2;/);
      expect(css).toMatch(
        /\[data-deck-morph-back-peek="true"\]\s*\{[^}]*will-change:\s*transform, opacity;/,
      );
      expect(css).not.toContain('[data-deck-morph-third="true"]');
    }),
  );

  it.effect("keeps each pointerless glass proxy inside its moving card", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(
        /\.workspace-card-deck__morph-proxy\s*\{[^}]*position:\s*absolute;[^}]*border:\s*1px solid;[^}]*pointer-events:\s*none;/,
      );
      expect(css).not.toMatch(/\.workspace-card-deck__morph-proxy\s*\{[^}]*position:\s*fixed;/);
      expect(css).toMatch(
        /\[data-deck-morph-surface="true"\]\s*\{[^}]*border-color:\s*transparent[^}]*background:\s*transparent[^}]*box-shadow:\s*none/,
      );
      expect(css).not.toMatch(
        /\[data-deck-morph-surface="true"\]\s*\{[^}]*border-radius:\s*0\s*!important/,
      );
    }),
  );

  it.effect("keeps static peek content on the activator while preserving marked controls", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(/\.workspace-card-deck__peek-trigger\s*\{[^}]*z-index:\s*1;/);
      expect(css).toMatch(
        /\.workspace-card-deck__peek-content\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*2;[^}]*pointer-events:\s*none;/,
      );
      expect(css).toMatch(
        /\[data-git-workspace-context-control="true"\]\s*\{[^}]*z-index:\s*3;[^}]*pointer-events:\s*auto;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__peek-content > \[data-workspace-card-peek-id\]\s*\{[^}]*display:\s*flex;[^}]*height:\s*100%;[^}]*align-items:\s*center;[^}]*padding-inline:\s*1rem;/,
      );
    }),
  );

  it.effect("limits compositor hints to the moving cards and settling peek labels", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(
        /\.workspace-card-deck\[data-deck-motion="morph"\][\s\S]*?\.workspace-card-deck__card\[data-transition-role="incoming"\][\s\S]*?\.workspace-card-deck__intrinsic\s*\{[^}]*will-change:\s*transform, clip-path, border-radius, opacity;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck\[data-deck-motion="fallback"\][\s\S]*?\.workspace-card-deck__peek-content\s*\{[^}]*will-change:\s*transform, opacity;/,
      );
      expect(css).not.toMatch(/\.workspace-card-deck__card\s*\{[^}]*will-change:/);
      expect(css).not.toMatch(/\.workspace-card-deck__card\s*\{[^}]*opacity:/);
      expect(css).not.toMatch(/\.workspace-card-deck__card-content\s*\{[^}]*will-change:/);
      expect(css).not.toMatch(/\.workspace-card-deck__surface\s*\{[^}]*opacity:/);
      expect(css).not.toMatch(/\.workspace-card-deck__peek\s*\{[^}]*opacity:/);
    }),
  );

  it.effect("disables transforms, fades, and height transitions for reduced motion", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workspace-card-deck__viewport\s*\{[^}]*transition:\s*none;/,
      );
      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workspace-card-deck\[data-deck-transition\][\s\S]*?animation:\s*none;/,
      );
    }),
  );
});
