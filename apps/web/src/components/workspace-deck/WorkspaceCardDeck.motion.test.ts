import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const deckCssPath = decodeURIComponent(
  new URL("./WorkspaceCardDeck.css", import.meta.url).pathname,
);
const readDeckCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(deckCssPath);
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
        /\.workspace-card-deck__viewport\[data-expanded="true"\]\s*\{[^}]*transition:\s*none;/,
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

  it.effect("moves cards only vertically after the outgoing content fade", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;
      const cardKeyframes = css.slice(
        css.indexOf("@keyframes workspace-card-to-front"),
        css.indexOf("@keyframes workspace-content-to-back"),
      );

      expect(css).toMatch(/workspace-card-to-front 600ms[^;]*90ms both/);
      expect(css).toMatch(/workspace-card-to-back 600ms[^;]*90ms both/);
      expect(css).toMatch(/workspace-content-to-back 90ms[^;]*both/);
      expect(css).toMatch(/workspace-content-to-front 300ms[^;]*350ms both/);
      expect(css).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
      expect(cardKeyframes).toContain("translate3d(0,");
      expect(cardKeyframes).not.toContain("opacity:");
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
        /\.workspace-card-deck__viewport\[data-collapsing="true"\]\s*\{[^}]*will-change:\s*height;/,
      );
      expect(css).not.toMatch(
        /\.workspace-card-deck\[data-deck-collapsing\][^{]*\{[^}]*animation:/,
      );
    }),
  );

  it.effect("moves the outgoing card toward its new exposed edge", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(
        /\[data-deck-transition="forward"\]\s*\{[^}]*--workspace-card-shuffle-out-y:\s*-1rem;[^}]*--workspace-card-shuffle-end-y:\s*-0\.625rem;/,
      );
      expect(css).toMatch(
        /\[data-deck-transition="backward"\]\s*\{[^}]*--workspace-card-shuffle-out-y:\s*1rem;[^}]*--workspace-card-shuffle-end-y:\s*0\.625rem;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck\[data-deck-transition\][\s\S]*?\.workspace-card-deck__peek-content\s*\{[^}]*animation:\s*workspace-content-to-front 300ms[^;]*350ms both;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck\[data-deck-transition\][\s\S]*?\.workspace-card-deck__card\[data-transition-role="incoming"\][\s\S]*?overflow:\s*clip;/,
      );
      expect(css).not.toMatch(/\.workspace-card-deck__peek\s*\{[^}]*animation:/);
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
        /\.workspace-card-deck__peek-content > \[data-workspace-card-peek-id\]\s*\{[^}]*display:\s*flex;[^}]*height:\s*100%;[^}]*align-items:\s*center;[^}]*padding-inline:\s*0\.75rem;/,
      );
    }),
  );

  it.effect("limits opacity and will-change to transition content and participating cards", () =>
    Effect.gen(function* () {
      const css = yield* readDeckCss;

      expect(css).toMatch(
        /\.workspace-card-deck\[data-deck-transition\][\s\S]*?\.workspace-card-deck__card\[data-transition-role="incoming"\][^{]*\{[^}]*will-change:\s*transform;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck\[data-deck-transition\][\s\S]*?\.workspace-card-deck__card-content\s*\{[^}]*will-change:\s*opacity;/,
      );
      expect(css).not.toMatch(/\.workspace-card-deck__card\s*\{[^}]*will-change:/);
      expect(css).not.toMatch(/\.workspace-card-deck__card\s*\{[^}]*opacity:/);
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
