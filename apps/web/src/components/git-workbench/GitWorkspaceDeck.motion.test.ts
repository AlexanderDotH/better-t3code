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
const readGitDeckCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(gitDeckCssPath);
}).pipe(Effect.provide(NodeServices.layer));
const readWorkspaceDeckCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(workspaceDeckCssPath);
}).pipe(Effect.provide(NodeServices.layer));

describe("Git workspace deck motion CSS", () => {
  it.effect("uses one equal-size compact viewport with 32px inset card peeks", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;

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
        /\.workspace-card-deck__viewport\s*\{[^}]*transition:\s*height 200ms ease-out;/,
      );
    }),
  );

  it.effect("keeps non-adjacent bodies mounted but visually hidden at rest", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;

      expect(css).toMatch(/\.workspace-card-deck__card\s*\{[^}]*visibility:\s*hidden;/);
      expect(css).toMatch(
        /\.workspace-card-deck__card\[data-card-position="active"\]\s*\{[^}]*visibility:\s*visible;/,
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
      expect(css).toMatch(
        /\.git-workbench-drawer--embedded \.git-workbench-drawer__resize-handle\s*\{[^}]*inset-block-start:\s*0;/,
      );
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

  it.effect("moves cards on one clipped vertical track without fading their contents", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;
      const cardKeyframes = css.slice(
        css.indexOf("@keyframes workspace-card-carousel-in"),
        css.indexOf("@keyframes workspace-peek-carousel-settle"),
      );

      expect(css).toContain("@keyframes workspace-card-carousel-in");
      expect(css).toContain("@keyframes workspace-card-carousel-out");
      expect(css).toMatch(/workspace-card-carousel-in 420ms[^;]*both/);
      expect(css).toMatch(/workspace-card-carousel-out 420ms[^;]*both/);
      expect(css).toMatch(/translate3d\(0,\s*var\(--workspace-card-[^)]+-y\),\s*0\)/);
      expect(css).not.toContain("rotate(");
      expect(cardKeyframes).not.toContain("opacity:");
      expect(css).toMatch(
        /\.workspace-card-deck\[data-deck-transition\][\s\S]*?\.workspace-card-deck__card\[data-transition-role="incoming"\][\s\S]*?will-change:\s*transform;/,
      );
      expect(css).not.toMatch(/\.workspace-card-deck__card\s*\{[^}]*filter:/);
      expect(css).not.toMatch(/\.workspace-card-deck__card\s*\{[^}]*(?:opacity|backdrop-filter):/);
    }),
  );

  it.effect("settles peek labels after the card shuffle without animating card contents", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;

      expect(css).toContain("@keyframes workspace-peek-carousel-settle");
      expect(css).toMatch(/workspace-peek-carousel-settle 180ms[^;]*240ms both/);
      expect(css).toMatch(
        /@keyframes workspace-peek-carousel-settle[\s\S]*?0%\s*\{[^}]*opacity:\s*0;[\s\S]*?100%\s*\{[^}]*opacity:\s*1;/,
      );
      expect(css).not.toMatch(/\.workspace-card-deck__card-content\s*\{[^}]*animation:/);
    }),
  );

  it.effect("limits will-change to active transitions", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;

      const idleCardRule = css.match(/\.workspace-card-deck__card\s*\{([^}]*)\}/)?.[1] ?? "";
      expect(idleCardRule).not.toContain("will-change");
      expect(css).toMatch(
        /\.workspace-card-deck\[data-deck-transition\][\s\S]*?\.workspace-card-deck__card\[data-transition-role="incoming"\][\s\S]*?will-change:\s*transform;/,
      );
    }),
  );

  it.effect("swaps and resizes immediately when reduced motion is requested", () =>
    Effect.gen(function* () {
      const css = yield* readWorkspaceDeckCss;

      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workspace-card-deck__viewport\s*\{[^}]*transition:\s*none;/,
      );
      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workspace-card-deck\[data-deck-transition\][\s\S]*?animation:\s*none;/,
      );
      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workspace-card-deck__peek-content[\s\S]*?animation:\s*none;/,
      );
    }),
  );
});
