export const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;

type ComposerFooterBreakpointOptions = {
  readonly hasContextWindowControl?: boolean;
  readonly hasWideActions?: boolean;
};

export function resolveComposerFooterGapClassName(input: {
  readonly compact: boolean;
  readonly voiceRecordingActive: boolean;
}): string {
  if (input.voiceRecordingActive) {
    return "gap-3 sm:gap-3";
  }
  return input.compact ? "gap-1.5" : "gap-2 sm:gap-0";
}

export function shouldUseCompactComposerFooter(
  width: number | null,
  options?: ComposerFooterBreakpointOptions,
): boolean {
  const breakpoint =
    options?.hasWideActions || options?.hasContextWindowControl
      ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
      : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX;
  return width !== null && width < breakpoint;
}

export function shouldUseCompactComposerControls(
  width: number | null,
  options: ComposerFooterBreakpointOptions & {
    readonly showExpandedComposerControls: boolean;
  },
): boolean {
  if (!options.showExpandedComposerControls) {
    return true;
  }
  // The left controls already scroll horizontally, so an explicit expanded
  // preference should only yield to genuinely wide primary-action states.
  return shouldUseCompactComposerFooter(width, {
    hasWideActions: options.hasWideActions === true,
  });
}

export function shouldUseCompactComposerPrimaryActions(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  if (!options?.hasWideActions) {
    return false;
  }
  return width !== null && width < COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX;
}
