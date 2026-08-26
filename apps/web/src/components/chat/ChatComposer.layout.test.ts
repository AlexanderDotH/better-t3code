import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import chatComposerSource from "./ChatComposer.tsx?raw";
import chatViewSource from "../ChatView.tsx?raw";

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

describe("ChatComposer surface morph integration", () => {
  it("keeps explicit drawer origins paired with their real composer triggers", () => {
    expect(chatComposerSource).toContain('data-composer-surface-morph-trigger="command"');
    expect(chatComposerSource).toContain(
      'setAttribute("data-composer-surface-morph-trigger", "stash")',
    );
    expect(chatComposerSource).toContain(
      'setAttribute("data-composer-surface-morph-trigger", "tasks")',
    );
    expect(chatComposerSource).toContain(
      'setAttribute("data-composer-surface-morph-origin", "tasks")',
    );
    expect(chatComposerSource).toContain('originKey="stash"');
    expect(chatComposerSource).toContain('originKey="command"');
    expect(chatComposerSource).toContain("data-composer-surface-morph-origin={props.originKey}");
    expect(chatComposerSource).toContain(
      'trigger.removeAttribute("data-composer-surface-morph-trigger")',
    );
    expect(chatComposerSource).toContain(
      'drawer.removeAttribute("data-composer-surface-morph-origin")',
    );
  });

  it("does not turn static composer content into a shared transform surface", () => {
    expect(chatComposerSource).not.toContain('data-composer-surface-morph-key="composer"');
    expect(chatComposerSource).not.toContain('data-composer-surface-morph-key="automatic-drawer"');
    expect(chatComposerSource).not.toContain(
      'data-composer-surface-morph-key="preview-annotations"',
    );
    expect(chatComposerSource).not.toContain('data-composer-surface-morph-key="review-comments"');
    expect(chatComposerSource).not.toContain('data-composer-surface-morph-key="element-contexts"');
    expect(chatComposerSource).not.toContain(
      "data-composer-surface-morph-key={`attachment:${image.id}`}",
    );
  });

  it("owns the drawer coordinator inside the composer instead of the outer chat layout", () => {
    expect(chatComposerSource).toContain("createSurfaceMorphCoordinator");
    expect(chatComposerSource).toContain("COMPOSER_SECONDARY_MORPH_DURATION_MS");
    expect(chatComposerSource).toContain("surfaceMorphCoordinator?.dispose()");
    expect(chatViewSource).not.toContain("createSurfaceMorphCoordinator");
  });

  it("moves the outer composer group only for the hero-to-dock state change", () => {
    const hookSource = chatViewSource.slice(
      chatViewSource.indexOf("function useDraftHeroLayoutTransition"),
      chatViewSource.indexOf("const PreviewPanel"),
    );

    expect(hookSource).toContain("stateChanged &&");
    expect(hookSource).toContain("transitionGroup.animate(");
    expect(hookSource).not.toContain("coordinator.run(");
    expect(hookSource).not.toContain("scale(");
  });

  it("keeps detached drawer exits visual-only while live React state changes", () => {
    expect(chatComposerSource).toContain(
      'proxy.setAttribute("data-composer-surface-morph-exit-proxy", "true")',
    );
    expect(chatComposerSource).toContain('proxy.setAttribute("aria-hidden", "true")');
    expect(chatComposerSource).toContain('proxy.setAttribute("inert", "")');
    expect(chatComposerSource).toContain('proxy.removeAttribute("id")');
    expect(chatComposerSource).toContain('proxy.style.pointerEvents = "none"');
    expect(chatComposerSource).toContain("durationMs: SURFACE_MORPH_EXIT_DURATION_MS");
  });
});
