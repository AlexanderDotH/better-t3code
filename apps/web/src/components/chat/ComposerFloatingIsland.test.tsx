import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ComposerFloatingIsland,
  ComposerFloatingIslandSection,
  FLOATING_ISLAND_EXIT_DURATION_MS,
  resolveFloatingIslandMotion,
} from "./ComposerFloatingIsland";

const indexCssPath = decodeURIComponent(new URL("../../index.css", import.meta.url).pathname);
const surfaceMorphCssPath = decodeURIComponent(
  new URL("./ComposerSurfaceMorph.css", import.meta.url).pathname,
);
const floatingIslandSourcePath = decodeURIComponent(
  new URL("./ComposerFloatingIsland.tsx", import.meta.url).pathname,
);
const proposedPlanCardSourcePath = decodeURIComponent(
  new URL("./ProposedPlanCard.tsx", import.meta.url).pathname,
);
const readIndexCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(indexCssPath);
}).pipe(Effect.provide(NodeServices.layer));
const readSurfaceMorphCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(surfaceMorphCssPath);
}).pipe(Effect.provide(NodeServices.layer));
const readFloatingIslandSource = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(floatingIslandSourcePath);
}).pipe(Effect.provide(NodeServices.layer));
const readProposedPlanCardSource = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(proposedPlanCardSourcePath);
}).pipe(Effect.provide(NodeServices.layer));

describe("ComposerFloatingIsland", () => {
  it("composes independent status sources and the portal host inside one shared surface", () => {
    const markup = renderToStaticMarkup(
      <ComposerFloatingIsland portalHostRef={() => undefined}>
        <ComposerFloatingIslandSection>
          <div>Provider status</div>
        </ComposerFloatingIslandSection>
        <ComposerFloatingIslandSection>
          <div>Thread sync</div>
        </ComposerFloatingIslandSection>
      </ComposerFloatingIsland>,
    );

    expect(markup).toContain('data-chat-composer-floating-island-region="true"');
    expect(markup).toContain('data-chat-composer-floating-island="true"');
    expect(markup.match(/data-chat-composer-floating-island-section="true"/g)).toHaveLength(2);
    expect(markup).toContain('data-chat-composer-floating-drawer-host="true"');
    expect(markup).toContain('data-composer-surface-morph-layer="true"');
    expect(markup).toContain('data-composer-surface-morph-kind="droplet"');
    expect(markup).toContain('data-composer-surface-morph-chrome="true"');
    expect(markup).toContain('data-composer-surface-morph-neck="true"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert=""');
    expect(markup.indexOf("Thread sync")).toBeLessThan(
      markup.indexOf('data-chat-composer-floating-drawer-host="true"'),
    );
  });

  it("chooses the newest meaningful surface mutation without replaying content-only updates", () => {
    expect(
      resolveFloatingIslandMotion({
        addedSurfaceCount: 1,
        isVisible: true,
        removedSurfaceCount: 0,
        wasVisible: false,
      }),
    ).toBe("enter");
    expect(
      resolveFloatingIslandMotion({
        addedSurfaceCount: 1,
        isVisible: true,
        removedSurfaceCount: 1,
        wasVisible: true,
      }),
    ).toBe("enter");
    expect(
      resolveFloatingIslandMotion({
        addedSurfaceCount: 0,
        isVisible: true,
        removedSurfaceCount: 1,
        wasVisible: true,
      }),
    ).toBe("enter");
    expect(
      resolveFloatingIslandMotion({
        addedSurfaceCount: 0,
        isVisible: false,
        removedSurfaceCount: 1,
        wasVisible: true,
      }),
    ).toBe("exit");
    expect(
      resolveFloatingIslandMotion({
        addedSurfaceCount: 0,
        isVisible: true,
        removedSurfaceCount: 0,
        wasVisible: true,
      }),
    ).toBeNull();
    expect(FLOATING_ISLAND_EXIT_DURATION_MS).toBe(360);
  });

  it.effect("keeps shared surfaces joined while banner-only regions render independent pills", () =>
    Effect.gen(function* () {
      const indexCssSource = yield* readIndexCss;

      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-island-region\s*{[^}]*padding-bottom:\s*0\.5rem;/s,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-island\s*{[^}]*overflow:\s*clip;[^}]*border:\s*1px solid var\(--chat-composer-floating-island-outline\);[^}]*border-radius:\s*16px;/s,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-island\s+:is\([\s\S]*?\)::before\s*{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*backdrop-filter:\s*none;/s,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-island\s+\.chat-composer-floating-drawer-host:not\(:empty\)\s*{[^}]*gap:\s*1px;[^}]*padding-bottom:\s*0;/s,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-island\s+\.chat-composer-floating-island-section\s*>\s*:is\(\s*\.chat-composer-drawer-slot,\s*\.chat-composer-drawer-surface\s*\)[^{]*{[^}]*margin:\s*0;/s,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-top-drawer-floating,\s*\.chat-composer-drawer-slot\.chat-composer-drawer-floating\s*{[^}]*margin-bottom:\s*0\.5rem;/s,
      );
      expect(indexCssSource).not.toContain("chat-composer-banner-stack-has-stack");
      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-island:has\([\s\S]*?> \.chat-composer-floating-island-section > \.chat-composer-banner-list[\s\S]*?\)\s*{[^}]*overflow:\s*visible;[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*backdrop-filter:\s*none;[^}]*box-shadow:\s*none;/s,
      );
      expect(indexCssSource).toContain(
        '.chat-composer-floating-island:has([data-variant="warning"])',
      );
      expect(indexCssSource).toContain(
        '.chat-composer-floating-island:has([data-variant="error"])',
      );
      expect(
        indexCssSource.indexOf('.chat-composer-floating-island:has([data-variant="error"])'),
      ).toBeGreaterThan(
        indexCssSource.indexOf('.chat-composer-floating-island:has([data-variant="warning"])'),
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-island:has\(\s*>\s*\.chat-composer-floating-drawer-host\s*>\s*\[data-variant="info"\]\s*\)\s*{[^}]*--chat-composer-floating-island-outline:\s*color-mix\(in srgb, var\(--info\) 32%, transparent\);/s,
      );
      expect(indexCssSource).toMatch(
        /\.resource-protection-banner-surface\[data-variant="warning"\]\s*{[^}]*border-color:\s*color-mix\(in srgb, var\(--warning\) 48%, transparent\);[^}]*background:[^}]*color-mix\(in srgb, var\(--warning\) 16%, transparent\)[,;]/s,
      );
    }),
  );

  it.effect("keeps every chat context bubble on one moody blue, readable surface", () =>
    Effect.gen(function* () {
      const indexCssSource = yield* readIndexCss;
      const proposedPlanCardSource = yield* readProposedPlanCardSource;

      expect(indexCssSource).toMatch(
        /--chat-context-bubble-surface:\s*color-mix\(\s*in srgb,\s*var\(--color-blue-100\) 72%,\s*var\(--color-white\)\s*\);/s,
      );
      expect(indexCssSource).toMatch(
        /--chat-context-bubble-surface:\s*color-mix\(\s*in srgb,\s*var\(--color-blue-950\) 64%,\s*var\(--color-neutral-950\)\s*\);/s,
      );
      expect(indexCssSource).toContain("--chat-context-bubble-foreground: var(--color-blue-50);");
      expect(indexCssSource).toContain(
        "--chat-context-bubble-muted-foreground: var(--color-blue-200);",
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-island-region[\s\S]*?--muted-foreground:\s*var\(--chat-context-bubble-muted-foreground\);/,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-island\s*{[^}]*--chat-composer-floating-island-surface:\s*var\(--chat-context-bubble-surface\);/s,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-island\s*{[\s\S]*?@variant dark\s*{[^}]*--chat-composer-floating-island-surface:\s*var\(--chat-context-bubble-surface\);/,
      );
      expect(indexCssSource).toMatch(
        /:is\(\s*\.chat-composer-top-drawer-floating,\s*\.chat-composer-drawer-surface\.chat-composer-drawer-floating\s*\)\s*{[^}]*--chat-composer-attached-surface:\s*var\(--chat-context-bubble-surface\);/s,
      );
      expect(indexCssSource).toMatch(
        /@utility alert-glass\s*{[\s\S]*?var\(--chat-context-bubble-surface\) var\(--glass-opacity\)/,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-shoulder-tab\[data-variant\]\s*{[^}]*var\(--chat-context-bubble-surface\) var\(--glass-opacity\)/s,
      );
      expect(indexCssSource).toMatch(
        /\.resource-protection-banner-surface\[data-variant="warning"\]\s*{[\s\S]*?var\(--chat-context-bubble-surface\) var\(--glass-opacity\)/,
      );
      expect(indexCssSource).toMatch(
        /\[data-chat-context-bubble\]\s*{[^}]*background:\s*var\(--chat-context-bubble-surface\);/s,
      );
      expect(proposedPlanCardSource).toContain('data-chat-context-bubble="plan"');
      expect(proposedPlanCardSource).not.toContain("bg-card/70");
    }),
  );

  it.effect("defines the complete sandglass droplet and reduced-motion contract", () =>
    Effect.gen(function* () {
      const surfaceMorphCssSource = yield* readSurfaceMorphCss;
      const floatingIslandSource = yield* readFloatingIslandSource;

      expect(surfaceMorphCssSource).toMatch(
        /\[data-composer-surface-morph-layer="true"\][^{]*\{[^}]*pointer-events:\s*none;/s,
      );
      expect(surfaceMorphCssSource).toContain("--composer-droplet-neck-phase: 22%");
      expect(surfaceMorphCssSource).toContain("--composer-droplet-rise-phase: 68%");
      expect(surfaceMorphCssSource).toContain("--composer-droplet-detach-phase: 84%");
      expect(surfaceMorphCssSource).toContain("--composer-droplet-settle-phase: 100%");
      expect(surfaceMorphCssSource).toContain("border-radius: 16px");
      expect(surfaceMorphCssSource).toContain("@media (prefers-reduced-motion: reduce)");
      expect(surfaceMorphCssSource).toMatch(
        /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:\s*0\.001ms\s*!important;/,
      );
      expect(floatingIslandSource).toContain("descriptor.chromeKeyframes");
      expect(floatingIslandSource).toContain(
        `':scope > [data-composer-surface-morph-exit-ghost="true"]'`,
      );
      expect(floatingIslandSource).toContain("ghost.remove()");
    }),
  );
});
