import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  resolveComposerFooterGapClassName,
  shouldUseCompactComposerControls,
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
} from "./composerFooterLayout";

describe("resolveComposerFooterGapClassName", () => {
  it("keeps active dictation separated from the left controls at every breakpoint", () => {
    expect(resolveComposerFooterGapClassName({ compact: false, voiceRecordingActive: true })).toBe(
      "gap-3 sm:gap-3",
    );
    expect(resolveComposerFooterGapClassName({ compact: true, voiceRecordingActive: true })).toBe(
      "gap-3 sm:gap-3",
    );
  });

  it("preserves the existing idle compact and desktop spacing", () => {
    expect(resolveComposerFooterGapClassName({ compact: true, voiceRecordingActive: false })).toBe(
      "gap-1.5",
    );
    expect(resolveComposerFooterGapClassName({ compact: false, voiceRecordingActive: false })).toBe(
      "gap-2 sm:gap-0",
    );
  });
});

describe("shouldUseCompactComposerFooter", () => {
  it("stays expanded without a measured width", () => {
    expect(shouldUseCompactComposerFooter(null)).toBe(false);
  });

  it("switches to compact mode below the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1)).toBe(true);
  });

  it("stays expanded at and above the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX)).toBe(false);
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX + 48)).toBe(false);
  });

  it("uses a higher breakpoint for wide action states", () => {
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });

  it("uses the wider breakpoint when the Codex context selector is visible", () => {
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasContextWindowControl: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasContextWindowControl: true,
      }),
    ).toBe(false);
  });
});

describe("shouldUseCompactComposerControls", () => {
  it("keeps composer controls bundled when expanded controls are disabled", () => {
    expect(
      shouldUseCompactComposerControls(null, {
        showExpandedComposerControls: false,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerControls(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX + 200, {
        showExpandedComposerControls: false,
      }),
    ).toBe(true);
  });

  it("expands controls at the normal footer breakpoint when the preference is enabled", () => {
    expect(
      shouldUseCompactComposerControls(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1, {
        showExpandedComposerControls: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerControls(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX, {
        showExpandedComposerControls: true,
      }),
    ).toBe(false);
  });

  it("keeps context-capable controls expanded at 768px when the preference is enabled", () => {
    expect(
      shouldUseCompactComposerControls(768, {
        showExpandedComposerControls: true,
        hasContextWindowControl: true,
      }),
    ).toBe(false);
    expect(
      shouldUseCompactComposerControls(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1, {
        showExpandedComposerControls: true,
        hasContextWindowControl: true,
      }),
    ).toBe(true);
  });

  it("retains the wider breakpoint for wide action states", () => {
    const widthBelowWideBreakpoint = COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1;
    const widthAtWideBreakpoint = COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX;

    expect(
      shouldUseCompactComposerControls(widthBelowWideBreakpoint, {
        showExpandedComposerControls: true,
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerControls(widthAtWideBreakpoint, {
        showExpandedComposerControls: true,
        hasWideActions: true,
      }),
    ).toBe(false);
  });

  it("stays expanded before the composer width has been measured when enabled", () => {
    expect(
      shouldUseCompactComposerControls(null, {
        showExpandedComposerControls: true,
        hasContextWindowControl: true,
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});

describe("shouldUseCompactComposerPrimaryActions", () => {
  it("matches the wide footer breakpoint", () => {
    expect(
      shouldUseCompactComposerPrimaryActions(
        COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1,
        { hasWideActions: true },
      ),
    ).toBe(true);
    expect(
      shouldUseCompactComposerPrimaryActions(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});
