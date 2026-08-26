import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const gitDeckCssPath = decodeURIComponent(
  new URL("./GitWorkspaceDeck.css", import.meta.url).pathname,
);
const workspaceDeckCssPath = decodeURIComponent(
  new URL("../workspace-deck/WorkspaceCardDeck.css", import.meta.url).pathname,
);
const surfaceMorphPath = decodeURIComponent(
  new URL("../chat/surfaceMorph.ts", import.meta.url).pathname,
);
const workspaceDeckSourcePath = decodeURIComponent(
  new URL("../workspace-deck/WorkspaceCardDeck.tsx", import.meta.url).pathname,
);
const workspaceDeckMorphSourcePath = decodeURIComponent(
  new URL("../workspace-deck/workspaceCardDeck.morph.ts", import.meta.url).pathname,
);
const readGitDeckCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(gitDeckCssPath);
}).pipe(Effect.provide(NodeServices.layer));
const readWorkspaceDeckCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(workspaceDeckCssPath);
}).pipe(Effect.provide(NodeServices.layer));
const readSurfaceMorphContract = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const surfaceMorphSource = yield* fileSystem.readFileString(surfaceMorphPath);
  const workspaceDeckSource = yield* fileSystem.readFileString(workspaceDeckSourcePath);
  const workspaceDeckMorphSource = yield* fileSystem.readFileString(workspaceDeckMorphSourcePath);
  return { surfaceMorphSource, workspaceDeckMorphSource, workspaceDeckSource };
}).pipe(Effect.provide(NodeServices.layer));

describe("Git workspace deck motion CSS", () => {
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
      expect(css).toMatch(
        /\[data-deck-morph-back-peek="true"\]\s*\{[^}]*will-change:\s*transform, opacity;/,
      );
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

  it.effect("morphs full card contents for 560ms with only a subtle transition fade", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;
      const { surfaceMorphSource, workspaceDeckMorphSource, workspaceDeckSource } =
        yield* readSurfaceMorphContract;

      expect(surfaceMorphSource).toMatch(/SURFACE_MORPH_PRIMARY_DURATION_MS\s*=\s*480\b/);
      expect(workspaceDeckMorphSource).toMatch(/WORKSPACE_DECK_MORPH_DURATION_MS\s*=\s*560\b/);
      expect(workspaceDeckMorphSource).toMatch(/WORKSPACE_DECK_CONTENT_PEEK_OPACITY\s*=\s*0\.84\b/);
      expect(workspaceDeckSource).toMatch(/from\s+["'][^"']*surfaceMorph["']/);
      expect(surfaceMorphSource).toMatch(/scale[XY]?/);
      expect(css).not.toMatch(/\.workspace-card-deck__card\s*\{[^}]*filter:/);
      expect(css).not.toMatch(/\.workspace-card-deck__card\s*\{[^}]*(?:opacity|backdrop-filter):/);
    }),
  );

  it.effect("gives animated chrome a pointerless, inert accessibility proxy", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;
      const { surfaceMorphSource, workspaceDeckMorphSource, workspaceDeckSource } =
        yield* readSurfaceMorphContract;
      const morphImplementation = `${surfaceMorphSource}\n${workspaceDeckSource}\n${workspaceDeckMorphSource}`;

      expect(morphImplementation).toMatch(/surfaceMorphProxy|data-surface-morph-proxy/);
      expect(morphImplementation).toMatch(/aria-hidden["']?,?\s*["']true/);
      expect(morphImplementation).toMatch(/setAttribute\(["']inert["'],\s*["']["']\)/);
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
      const { surfaceMorphSource, workspaceDeckSource } = yield* readSurfaceMorphContract;

      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workspace-card-deck__viewport\s*\{[^}]*transition:\s*none;/,
      );
      expect(surfaceMorphSource).toContain("prefersReducedSurfaceMotion");
      expect(surfaceMorphSource).toMatch(/\.animate\b|typeof[^\n]*animate/);
      expect(workspaceDeckSource).toContain("data-deck-motion");
      expect(css).toMatch(/\[data-deck-motion="fallback"\]/);
    }),
  );
});
