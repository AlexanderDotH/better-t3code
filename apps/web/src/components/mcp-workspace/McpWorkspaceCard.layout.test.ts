import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const cardCssPath = decodeURIComponent(new URL("./McpWorkspaceCard.css", import.meta.url).pathname);
const settingsPanelPath = decodeURIComponent(
  new URL("../settings/McpServersSettings.tsx", import.meta.url).pathname,
);
const readCardCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(cardCssPath);
}).pipe(Effect.provide(NodeServices.layer));
const readSettingsPanel = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(settingsPanelPath);
}).pipe(Effect.provide(NodeServices.layer));

describe("MCP workspace card layout", () => {
  it.effect("groups the MCP identity at the left and status at the right", () =>
    Effect.gen(function* () {
      const css = yield* readCardCss;

      expect(css).toMatch(
        /\.mcp-workspace-peek \.workspace-card-deck__peek-content > \.mcp-workspace-peek__content\s*\{[^}]*display:\s*flex;/,
      );
      expect(css).toMatch(
        /\.mcp-workspace-peek__status\s*\{[^}]*margin-inline-start:\s*auto;[^}]*max-width:\s*50%;/,
      );
      expect(css).not.toMatch(/\.mcp-workspace-peek__provider\s*\{[^}]*justify-self:\s*center;/);
    }),
  );

  it.effect("uses the Git notch control inset for both MCP label edges", () =>
    Effect.gen(function* () {
      const css = yield* readCardCss;

      expect(css).toMatch(
        /\.mcp-workspace-peek__content strong\s*\{[^}]*margin-inline-start:\s*calc\(var\(--spacing\) \* 2 - 1px\);/,
      );
      expect(css).toMatch(
        /\.mcp-workspace-peek__status\s*\{[^}]*margin-inline-end:\s*calc\(var\(--spacing\) \* 2 - 1px\);/,
      );
    }),
  );

  it.effect("renders every MCP peek state as gently faded neutral metadata", () =>
    Effect.gen(function* () {
      const css = yield* readCardCss;

      expect(css).toMatch(
        /\.mcp-workspace-peek \.workspace-card-deck__peek-content > \.mcp-workspace-peek__content\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--muted-foreground\) 78%, transparent\);/,
      );
      expect(css).toMatch(/\.mcp-workspace-peek__content strong\s*\{[^}]*color:\s*inherit;/);
      expect(css).not.toContain(
        '.mcp-workspace-peek__status[data-mcp-workspace-state="upgrade-required"]',
      );
    }),
  );

  it.effect("keeps selectors fixed while panel content owns vertical scrolling", () =>
    Effect.gen(function* () {
      const css = yield* readCardCss;

      expect(css).toMatch(/\.mcp-workspace-panel\s*\{[^}]*overflow:\s*hidden;/);
      expect(css).toMatch(/\.mcp-workspace-panel__selectors\s*\{[^}]*flex:\s*none;/);
      expect(css).toMatch(/\.mcp-workspace-panel__tabs\s*\{[^}]*flex:\s*none;/);
      expect(css).toMatch(
        /\.mcp-workspace-drawer\s*>\s*\.workspace-card-drawer__content\s*\{[^}]*overflow:\s*hidden;/,
      );
      expect(css).toMatch(
        /\.mcp-workspace-panel__content\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/,
      );
      expect(css).not.toMatch(/\.mcp-workspace-runtime\s*\{[^}]*overflow-y:/);
    }),
  );

  it.effect("removes page padding when settings render inside the MCP drawer", () =>
    Effect.gen(function* () {
      const settingsPanel = yield* readSettingsPanel;

      expect(settingsPanel).toContain('props.embedded && "max-w-none gap-3 p-0 sm:p-0"');
    }),
  );
});
