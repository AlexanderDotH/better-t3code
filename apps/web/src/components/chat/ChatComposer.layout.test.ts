import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import chatComposerSource from "./ChatComposer.tsx?raw";

const indexCssPath = decodeURIComponent(new URL("../../index.css", import.meta.url).pathname);
const readIndexCss = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readFileString(indexCssPath);
}).pipe(Effect.provide(NodeServices.layer));

describe("ChatComposer footer layout", () => {
  it("uses the expanded-controls preference and Codex context in the compact decision", () => {
    expect(chatComposerSource).toContain(
      "const composerFooterHasContextWindowControl = Boolean(providerContextWindowPicker);",
    );
    expect(chatComposerSource).toContain(
      "const footerCompact = shouldUseCompactComposerControls(composerFormWidth, {",
    );
    expect(chatComposerSource).toContain(
      "showExpandedComposerControls: settings.showExpandedComposerControls,",
    );
    expect(chatComposerSource).toContain(
      "hasContextWindowControl: composerFooterHasContextWindowControl,",
    );
  });

  it("renders context inline when bundled and as a separate picker when expanded", () => {
    const footerStart = chatComposerSource.indexOf('data-chat-composer-footer="true"');
    const footerSource = chatComposerSource.slice(footerStart);
    const traitsPickerIndex = footerSource.indexOf("{providerTraitsPicker}");
    const traitsContextSeparatorIndex = footerSource.indexOf(
      'data-chat-composer-traits-context-separator="true"',
    );
    const contextWindowPickerIndex = footerSource.indexOf("{providerContextWindowPicker}");

    expect(footerStart).toBeGreaterThanOrEqual(0);
    expect(traitsPickerIndex).toBeGreaterThanOrEqual(0);
    expect(traitsContextSeparatorIndex).toBeGreaterThan(traitsPickerIndex);
    expect(contextWindowPickerIndex).toBeGreaterThan(traitsContextSeparatorIndex);
    expect(footerSource).toContain("contextWindowMenuContent={providerContextWindowMenuContent}");
    expect(footerSource).not.toContain(
      "{isComposerFooterCompact ? providerContextWindowPicker : null}",
    );
  });

  it("commits context-window changes through thread metadata in both presentations", () => {
    const menuContentStart = chatComposerSource.indexOf(
      "const providerContextWindowMenuContent = renderProviderContextWindowMenuContent({",
    );
    const pickerStart = chatComposerSource.indexOf(
      "const providerContextWindowPicker = renderProviderContextWindowPicker({",
    );
    const providerControlsSource = chatComposerSource.slice(menuContentStart, pickerStart + 800);

    expect(menuContentStart).toBeGreaterThanOrEqual(0);
    expect(pickerStart).toBeGreaterThan(menuContentStart);
    expect(providerControlsSource.match(/onThreadModelSelectionChange,/g)).toHaveLength(2);
  });
});

describe("ChatComposer top-drawer layout", () => {
  it.effect("floats approvals, pending user input, and Plan ready above the composer surface", () =>
    Effect.gen(function* () {
      const indexCssSource = yield* readIndexCss;
      expect(chatComposerSource).toContain(
        'className="chat-composer-top-drawer chat-composer-top-drawer-floating"',
      );
      expect(chatComposerSource).toContain("floatingDrawerHost: HTMLElement | null;");
      expect(chatComposerSource).toContain(
        "<ComposerDetachedDrawerPortal host={props.floatingDrawerHost}>",
      );
      expect(chatComposerSource).toContain("const showFloatingTasksBadge =");
      expect(chatComposerSource).toContain('placement="floating"');
      expect(chatComposerSource).toContain(
        "return host ? createPortal(children, host) : children;",
      );
      expect(chatComposerSource).toContain(
        "(!isComposerCollapsedMobile && showPlanFollowUpPrompt && activeProposedPlan !== null)",
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-top-drawer-floating,\s*\.chat-composer-drawer-floating\s*{[^}]*--chat-composer-attachment-overlap:\s*0px;/s,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-drawer-slot\.chat-composer-drawer-floating\s*{[^}]*margin-bottom:\s*0\.5rem;/s,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-drawer-surface\.chat-composer-drawer-floating[\s\S]*?::before\s*{[^}]*border:\s*1px solid var\(--chat-composer-attached-outline\);[^}]*border-radius:\s*16px;[^}]*mask-image:\s*none;/s,
      );
      expect(indexCssSource).toMatch(
        /\.chat-composer-floating-drawer-host:not\(:empty\)\s*{[^}]*padding-bottom:\s*1rem;/s,
      );
    }),
  );
});
