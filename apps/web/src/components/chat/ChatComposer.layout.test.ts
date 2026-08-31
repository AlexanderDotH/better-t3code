import { describe, expect, it } from "@effect/vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import chatComposerSource from "./ChatComposer.tsx?raw";
import chatViewSource from "../ChatView.tsx?raw";
import { ComposerBanner } from "./ComposerBanner";
import { ComposerSurface } from "./ComposerSurface";

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
  it("attaches the banner surface ahead of the main composer surface", () => {
    const topDrawerProps = {
      "data-chat-composer-top-drawer": "true",
      variant: "warning",
    } as const;
    const html = renderToStaticMarkup(
      createElement(
        ComposerSurface.Shell,
        null,
        createElement(
          ComposerSurface.Host,
          null,
          createElement(
            "form",
            { "data-chat-composer-form": "true" },
            createElement(
              ComposerBanner.Attachment,
              null,
              createElement(
                ComposerBanner.Root,
                topDrawerProps,
                createElement(
                  ComposerBanner.Row,
                  null,
                  createElement(ComposerBanner.Content, null, "Approval required"),
                ),
              ),
            ),
            createElement(ComposerSurface.Main, null, "Composer"),
          ),
        ),
      ),
    );

    expect(html).toContain('data-slot="composer-shell"');
    expect(html).toContain('data-slot="composer-host"');
    expect(html).toContain('data-slot="composer-banner-attachment"');
    expect(html).toContain('data-composer-banner-surface="attached"');
    expect(html).toContain('data-chat-composer-top-drawer="true"');
    expect(html).toContain('data-chat-composer-main-surface="true"');
    expect(html.indexOf('data-chat-composer-top-drawer="true"')).toBeLessThan(
      html.indexOf('data-chat-composer-main-surface="true"'),
    );
  });

  it("routes approvals, pending input, and Plan ready through the floating bubble portal", () => {
    const drawerStart = chatComposerSource.indexOf(
      "{showComposerTopDrawer && (!isTasksDrawerOpen || hasBlockingComposerTopDrawer) ? (",
    );
    const drawerEnd = chatComposerSource.indexOf("</ComposerFloatingBubblePortal>", drawerStart);
    const drawerSource = chatComposerSource.slice(drawerStart, drawerEnd);

    expect(drawerStart).toBeGreaterThanOrEqual(0);
    expect(drawerEnd).toBeGreaterThan(drawerStart);
    expect(drawerSource).toContain("<ComposerBanner.Attachment>");
    expect(drawerSource).toContain('data-chat-composer-top-drawer="true"');
    expect(drawerSource).toContain("<ComposerPendingApprovalPanel");
    expect(drawerSource).toContain("<ComposerPendingUserInputPanel");
    expect(drawerSource).toContain("<ComposerPlanFollowUpBanner");
    expect(chatComposerSource).toContain("floatingBubbleHost: HTMLElement | null;");
    expect(chatComposerSource).toContain(
      "<ComposerFloatingBubblePortal host={props.floatingBubbleHost}>",
    );
    expect(chatComposerSource).not.toContain("floatingDrawerHost");
  });
});

describe("ChatComposer merged activity integration", () => {
  it("lets thread sync replace stale task progress and take activity priority", () => {
    expect(chatComposerSource).toContain(
      "const activeTasksProgress = props.threadSyncPhase === null ? props.activeTasksProgress : null;",
    );
    expect(chatComposerSource).toContain(
      "const activeTaskSteps = props.threadSyncPhase === null ? props.activeTaskSteps : null;",
    );
    expect(chatComposerSource).toContain('? { kind: "sync", phase: props.threadSyncPhase }');
    expect(chatComposerSource).toContain('priority: "activity"');
    expect(chatComposerSource).toContain("items={bannerStackItems}");
    expect(chatComposerSource).toContain(
      "<ComposerActivityBanner status={standaloneActivityStatus} />",
    );
  });

  it("keeps task, stash, voice, Plan, and provider-lock controls on the composed surface", () => {
    expect(chatComposerSource).toContain("<ComposerTasksDrawer");
    expect(chatComposerSource).toContain("<ComposerTasksBadge");
    expect(chatComposerSource).toContain("<ComposerStashBadge");
    expect(chatComposerSource).toContain("<VoiceDictationControl");
    expect(chatComposerSource).toContain("<ComposerPlanFollowUpBanner");
    expect(chatComposerSource).toContain("lockedProvider={lockedProvider}");
    expect(chatComposerSource).toContain("lockedContinuationGroupKey={lockedContinuationGroupKey}");
    expect(chatComposerSource).toContain("<ComposerSurface.Main");
  });

  it("closes transient task state when its owner disappears or becomes blocked", () => {
    expect(chatComposerSource).toContain(
      "if (activeTasksProgress === null || activeTaskSteps === null) {\n      setIsTasksDrawerOpen(false);",
    );
    expect(chatComposerSource).toContain(
      "if (hasBlockingComposerTopDrawer) {\n      setIsTasksDrawerOpen(false);",
    );
  });
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
