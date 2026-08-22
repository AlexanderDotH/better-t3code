import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { renderToStaticMarkup } from "react-dom/server";

import { ComposerFloatingIsland, ComposerFloatingIslandSection } from "./ComposerFloatingIsland";

const indexCssPath = decodeURIComponent(new URL("../../index.css", import.meta.url).pathname);
const readIndexCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(indexCssPath);
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
    expect(markup.indexOf("Thread sync")).toBeLessThan(
      markup.indexOf('data-chat-composer-floating-drawer-host="true"'),
    );
  });

  it.effect(
    "gives the island one outer shell while flattening and separating its child surfaces",
    () =>
      Effect.gen(function* () {
        const indexCssSource = yield* readIndexCss;

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
          /\.chat-composer-floating-island-section:has\(> \.chat-composer-banner-stack-has-stack\)\s*{[^}]*padding-top:\s*0\.75rem;/s,
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
      }),
  );
});
