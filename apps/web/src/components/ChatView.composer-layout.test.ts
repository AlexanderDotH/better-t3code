import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import chatViewSource from "./ChatView.tsx?raw";
import chatComposerSource from "./chat/ChatComposer.tsx?raw";
import composerFloatingIslandSource from "./chat/ComposerFloatingIsland.tsx?raw";
import surfaceMorphSource from "./chat/surfaceMorph.ts?raw";

const composerSurfaceMorphCssPath = decodeURIComponent(
  new URL("./chat/ComposerSurfaceMorph.css", import.meta.url).pathname,
);
const readComposerSurfaceMorphCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(composerSurfaceMorphCssPath);
}).pipe(Effect.provide(NodeServices.layer));

describe("ChatView composer overlay layout", () => {
  it("allows the draft composer card stack to shrink with a narrow chat column", () => {
    expect(chatViewSource).toContain(
      'className="chat-composer-horizontal-inset min-w-0 w-full ps-[calc(env(safe-area-inset-left)+0.75rem)]',
    );
  });

  it("composes every above-deck status source into one floating island", () => {
    const islandIndex = chatViewSource.indexOf("<ComposerFloatingIsland");
    const islandEndIndex = chatViewSource.indexOf("</ComposerFloatingIsland>", islandIndex);
    const bannerIndex = chatViewSource.indexOf("<ComposerBannerStack", islandIndex);
    const syncIndex = chatViewSource.indexOf("<ThreadSyncStatusPill", islandIndex);
    const deckIndex = chatViewSource.indexOf("<ChatWorkspaceDeckController");

    expect(chatViewSource).toContain(
      "const [composerFloatingDrawerHost, setComposerFloatingDrawerHost] =",
    );
    expect(islandIndex).toBeGreaterThanOrEqual(0);
    expect(bannerIndex).toBeGreaterThan(islandIndex);
    expect(syncIndex).toBeGreaterThan(bannerIndex);
    expect(islandEndIndex).toBeGreaterThan(syncIndex);
    expect(deckIndex).toBeGreaterThan(islandEndIndex);
    expect(chatViewSource).toContain("portalHostRef={setComposerFloatingDrawerHost}");
    expect(chatViewSource).toContain("floatingDrawerHost={composerFloatingDrawerHost}");
  });

  it("keeps morph origins on drawers without transforming static composer content", () => {
    expect(chatComposerSource).toContain("data-composer-surface-morph-origin=");
    expect(chatComposerSource).toContain("data-composer-surface-morph-trigger=");
    expect(chatComposerSource).not.toContain('data-composer-surface-morph-key="composer"');
    expect(chatComposerSource).not.toContain("data-composer-surface-morph-key={`attachment:");
    expect(chatComposerSource).not.toContain('data-composer-surface-morph-key="element-contexts"');
  });

  it("uses the shared 420ms secondary and 360ms exit contracts", () => {
    expect(surfaceMorphSource).toMatch(/SURFACE_MORPH_SECONDARY_DURATION_MS\s*=\s*420\b/);
    expect(surfaceMorphSource).toMatch(/SURFACE_MORPH_EXIT_DURATION_MS\s*=\s*360\b/);
  });

  it.effect("forms automatic floating drawers through the complete droplet phase sequence", () =>
    Effect.gen(function* () {
      const css = yield* readComposerSurfaceMorphCss;

      expect(surfaceMorphSource).toMatch(/start:\s*0(?:\.0+)?\b/);
      expect(surfaceMorphSource).toMatch(/neck:\s*0\.22\b/);
      expect(surfaceMorphSource).toMatch(/rise:\s*0\.68\b/);
      expect(surfaceMorphSource).toMatch(/detach:\s*0\.84\b/);
      expect(surfaceMorphSource).toMatch(/end:\s*1(?:\.0+)?\b/);
      expect(composerFloatingIslandSource).toContain('data-composer-surface-morph-kind="droplet"');
      expect(composerFloatingIslandSource).toContain('data-composer-surface-morph-chrome="true"');
      expect(composerFloatingIslandSource).toContain('data-composer-surface-morph-neck="true"');
      expect(css).toMatch(
        /\[data-composer-surface-morph-neck="true"\][\s\S]*?transform-origin:\s*50% 100%/,
      );
    }),
  );

  it("distinguishes clicked trigger origins from automatic composer-edge origins", () => {
    expect(composerFloatingIslandSource).toContain("data-composer-surface-morph-origin-mode");
    expect(composerFloatingIslandSource).toContain('"trigger"');
    expect(composerFloatingIslandSource).toContain('"automatic-edge"');
  });

  it.effect("keeps droplet chrome outside the interaction and accessibility trees", () =>
    Effect.gen(function* () {
      const css = yield* readComposerSurfaceMorphCss;

      expect(composerFloatingIslandSource).toContain('data-composer-surface-morph-layer="true"');
      expect(composerFloatingIslandSource).toContain('aria-hidden="true"');
      expect(composerFloatingIslandSource).toContain("inert");
      expect(css).toMatch(
        /\[data-composer-surface-morph-layer="true"\]\s*\{[^}]*pointer-events:\s*none;/,
      );
    }),
  );

  it.effect("disables decorative morphing when reduced motion is requested", () =>
    Effect.gen(function* () {
      const css = yield* readComposerSurfaceMorphCss;

      expect(surfaceMorphSource).toContain("prefersReducedSurfaceMotion");
      expect(css).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-composer-surface-morph-layer="true"\][\s\S]*?animation-duration:\s*0\.001ms\s*!important/,
      );
    }),
  );
});
