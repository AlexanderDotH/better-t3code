import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  prefersReducedSurfaceMotion,
  SURFACE_MORPH_PRIMARY_DURATION_MS,
} from "../chat/surfaceMorph";
import {
  buildWorkspaceDeckFrameMorphDescriptor,
  WORKSPACE_DECK_MORPH_DURATION_MS,
} from "../workspace-deck/workspaceCardDeck.morph";

const gitDeckCssPath = decodeURIComponent(
  new URL("./GitWorkspaceDeck.css", import.meta.url).pathname,
);
const workspaceDeckCssPath = decodeURIComponent(
  new URL("../workspace-deck/WorkspaceCardDeck.css", import.meta.url).pathname,
);
const readGitDeckCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(gitDeckCssPath);
}).pipe(Effect.provide(NodeServices.layer));
const readWorkspaceDeckCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(workspaceDeckCssPath);
}).pipe(Effect.provide(NodeServices.layer));

describe("Git workspace deck motion model behavior", () => {
  it("builds the 560ms chrome morph without scaling compact card contents", () => {
    const descriptor = buildWorkspaceDeckFrameMorphDescriptor({
      direction: "forward",
      durationMs: WORKSPACE_DECK_MORPH_DURATION_MS,
      from: {
        rect: { left: 22, top: 300, width: 356, height: 32 },
        radii: { topLeft: 0, topRight: 0, bottomRight: 16, bottomLeft: 16 },
      },
      role: "incoming",
      to: {
        rect: { left: 0, top: 100, width: 400, height: 200 },
        radii: { topLeft: 22, topRight: 22, bottomRight: 22, bottomLeft: 22 },
      },
    });

    expect(SURFACE_MORPH_PRIMARY_DURATION_MS).toBe(480);
    expect(WORKSPACE_DECK_MORPH_DURATION_MS).toBe(560);
    expect(descriptor.options.duration).toBe(560);
    expect(descriptor.geometryKeyframes).not.toHaveLength(0);
    expect(descriptor.cornerKeyframes).not.toHaveLength(0);
    expect(descriptor.appearanceKeyframes).not.toHaveLength(0);
    expect(
      descriptor.geometryKeyframes.every(
        (frame) =>
          !("scale" in frame) &&
          !("scaleX" in frame) &&
          !("scaleY" in frame) &&
          !("borderRadius" in frame) &&
          !("clipPath" in frame),
      ),
    ).toBe(true);
  });

  it("detects reduced motion before choosing an animated path", () => {
    expect(prefersReducedSurfaceMotion({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(prefersReducedSurfaceMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });
});

// Node has no CSS layout or animation engine. These source assertions are an
// explicit repository policy for cascade-only constraints; the descriptor,
// timing, and reduced-motion decisions are exercised through model APIs above.
describe("Git workspace deck motion CSS repository policy", () => {
  it.effect("keeps the equal-size compact viewport between mirrored 32px card peeks", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;
      const gitCss = yield* readGitDeckCss;

      expect(css).toMatch(/\.workspace-card-deck\s*\{[^}]*padding-block:\s*2rem;/);
      expect(css).toMatch(
        /\.workspace-card-deck__viewport\s*\{[^}]*height:\s*var\(--workspace-card-deck-compact-height\);/,
      );
      expect(css).toMatch(/\.workspace-card-deck__card\s*\{[^}]*(?:width|inline-size):\s*100%;/);
      expect(css).toMatch(
        /\.workspace-card-deck__viewport\[data-height-ready="true"\] \.workspace-card-deck__card\s*\{[^}]*(?:height|block-size):\s*100%;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__peek\s*\{[^}]*inset-inline:\s*1\.375rem;[^}]*(?:height|block-size):\s*2rem;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__peek--previous\s*\{[^}]*inset-block-start:\s*-2rem;[^}]*border-radius:\s*1rem 1rem 0 0;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__peek--next\s*\{[^}]*inset-block-end:\s*-2rem;[^}]*border-radius:\s*0 0 1rem 1rem;/,
      );
      expect(gitCss).toMatch(/\.git-compact-card\s*\{[^}]*border-radius:\s*1\.375rem;/);
      expect(css).toMatch(
        /\.workspace-card-deck__viewport\s*\{[^}]*transition:\s*height 200ms ease-out;/,
      );
    }),
  );

  it.effect("keeps the reordered back shell at the destination edge", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;

      expect(css).toMatch(/\.workspace-card-deck__peeks\s*\{[^}]*z-index:\s*1;/);
      expect(css).toMatch(/\.workspace-card-deck__viewport\s*\{[^}]*z-index:\s*2;/);
      expect(css).toMatch(/\.workspace-card-deck__card\s*\{[^}]*visibility:\s*hidden;/);
      expect(css).toMatch(
        /\.workspace-card-deck__card\[data-card-position="active"\]\s*\{[^}]*visibility:\s*visible;/,
      );
      expect(css).toMatch(
        /\.workspace-card-deck__viewport:not\(\[data-expanded="true"\]\)\s+\.workspace-card-deck__card\s*\{[^}]*overflow:\s*clip;/,
      );
      expect(css).toMatch(/\[data-deck-morph-back-peek="true"\]\s*\{[^}]*will-change:\s*opacity;/);
    }),
  );

  it.effect("keeps the expanded drawer within the Git card surface", () =>
    Effect.gen(function* () {
      const css = yield* readGitDeckCss;

      expect(css).toMatch(/\.git-compact-card\[data-expanded="true"\]\s*\{[^}]*padding:\s*0;/);
      expect(css).toMatch(
        /\.git-workbench-drawer--embedded\s*\{[^}]*border-block-start:\s*0;[^}]*border-radius:\s*inherit;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/,
      );
      expect(css).not.toContain("var(--git-workbench-drawer-height)");
      expect(css).not.toContain(".git-workbench-drawer__resize-handle");
      expect(css).not.toContain("100vw");
    }),
  );

  it.effect("keeps the compact Git summary fixed, pullable, and free of internal scrolling", () =>
    Effect.gen(function* () {
      const css = yield* readGitDeckCss;

      expect(css).toMatch(
        /\.git-compact-card\s*\{[^}]*container-name:\s*git-compact-card;[^}]*container-type:\s*inline-size;/,
      );
      expect(css).toMatch(
        /\.git-compact-card:not\(\[data-expanded="true"\]\) \.git-compact-card__content\s*\{[^}]*overflow:\s*hidden;/,
      );
      expect(css).toMatch(
        /\.git-compact-card__summary\s*\{[^}]*grid-template-areas:\s*"total groups diff";[^}]*grid-template-columns:/,
      );
      expect(css).toMatch(
        /\.git-compact-card__pull-handle\s*\{[^}]*touch-action:\s*none;[^}]*cursor:\s*ns-resize;/,
      );
      expect(css).toContain("@container git-compact-card (max-width: 32rem)");
      expect(css).not.toContain(".git-compact-card__insights");
      expect(css).not.toMatch(
        /@container git-compact-card \(max-width: 32rem\)[\s\S]*?\.git-compact-card__footer\s*\{[^}]*flex-direction:\s*column;/,
      );
      expect(css).not.toContain("@media (max-width: 52.5rem)");
    }),
  );

  it.effect("keeps compact card contents free of filter and opacity animation", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;
      expect(css).not.toMatch(/\.workspace-card-deck__card\s*\{[^}]*filter:/);
      expect(css).not.toMatch(/\.workspace-card-deck__card\s*\{[^}]*(?:opacity|backdrop-filter):/);
    }),
  );

  it.effect("gives animated chrome pointerless proxy styling", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;
      expect(css).toMatch(/\.workspace-card-deck__morph-proxy\s*\{[^}]*pointer-events:\s*none;/);
    }),
  );

  it.effect("limits compositor hints to active transitions", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;

      const idleCardRule = css.match(/\.workspace-card-deck__card\s*\{([^}]*)\}/)?.[1] ?? "";
      expect(idleCardRule).not.toContain("will-change");
      expect(css).not.toMatch(/\.workspace-card-deck__card-content\s*\{[^}]*will-change:/);
    }),
  );

  it.effect("swaps immediately for reduced motion and retains a safe non-WAAPI fallback", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;

      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workspace-card-deck__viewport\s*\{[^}]*transition:\s*none;/,
      );
      expect(css).toMatch(/\[data-deck-motion="fallback"\]/);
    }),
  );
});
