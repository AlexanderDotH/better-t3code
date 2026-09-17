const DEFAULT_CHAT_CONTENT_WIDTH_REM = 48;
const NARROWEST_CHAT_CONTENT_WIDTH_REM = DEFAULT_CHAT_CONTENT_WIDTH_REM / 2;
export const DEFAULT_CHAT_PREVIEW_WIDTH_PERCENT = 60;
const NARROWEST_CHAT_PREVIEW_WIDTH_PERCENT = DEFAULT_CHAT_PREVIEW_WIDTH_PERCENT / 2;

function formatRemValue(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Maps the signed adjustment onto half-default → default → full available width. */
export function resolveChatContentMaxWidth(
  customizationEnabled: boolean,
  adjustmentPercent: number,
): string {
  if (!customizationEnabled || adjustmentPercent === 0) {
    return `${DEFAULT_CHAT_CONTENT_WIDTH_REM}rem`;
  }

  if (adjustmentPercent < 0) {
    const widthRem =
      DEFAULT_CHAT_CONTENT_WIDTH_REM +
      (DEFAULT_CHAT_CONTENT_WIDTH_REM - NARROWEST_CHAT_CONTENT_WIDTH_REM) *
        (adjustmentPercent / 100);
    return `${formatRemValue(widthRem)}rem`;
  }

  if (adjustmentPercent === 100) return "100%";

  const defaultWidthRem = DEFAULT_CHAT_CONTENT_WIDTH_REM * (1 - adjustmentPercent / 100);
  return `calc(${formatRemValue(defaultWidthRem)}rem + ${adjustmentPercent}%)`;
}

/** Mirrors the real width curve inside a bounded settings preview canvas. */
export function resolveChatContentPreviewWidthPercent(
  customizationEnabled: boolean,
  adjustmentPercent: number,
): number {
  const adjustment = customizationEnabled ? Math.max(-100, Math.min(100, adjustmentPercent)) : 0;
  if (adjustment < 0) {
    return (
      DEFAULT_CHAT_PREVIEW_WIDTH_PERCENT +
      (DEFAULT_CHAT_PREVIEW_WIDTH_PERCENT - NARROWEST_CHAT_PREVIEW_WIDTH_PERCENT) *
        (adjustment / 100)
    );
  }
  return (
    DEFAULT_CHAT_PREVIEW_WIDTH_PERCENT +
    (100 - DEFAULT_CHAT_PREVIEW_WIDTH_PERCENT) * (adjustment / 100)
  );
}
