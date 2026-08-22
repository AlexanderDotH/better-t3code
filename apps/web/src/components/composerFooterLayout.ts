export const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;

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
  options?: { hasContextWindowControl?: boolean; hasWideActions?: boolean },
): boolean {
  const breakpoint =
    options?.hasWideActions || options?.hasContextWindowControl
      ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
      : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX;
  return width !== null && width < breakpoint;
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
