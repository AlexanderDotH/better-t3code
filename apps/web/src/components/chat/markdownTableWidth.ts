export const MARKDOWN_TABLE_DEFAULT_EXPANSION_RATIO = 1.5;
export const MARKDOWN_TABLE_VIEWPORT_GUTTER_PX = 40;
export const MARKDOWN_TABLE_RESIZE_EDGE_STEP_PX = 12;

export type MarkdownTableResizeEdge = "left" | "right";

export interface MarkdownTableWidthBounds {
  readonly minWidth: number;
  readonly maxWidth: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveMarkdownTableWidthBounds(
  contentWidth: number,
  chatColumnWidth: number,
): MarkdownTableWidthBounds {
  const availableWidth = Math.max(0, chatColumnWidth - MARKDOWN_TABLE_VIEWPORT_GUTTER_PX);
  const minWidth = Math.min(Math.max(0, contentWidth), availableWidth);
  return { minWidth, maxWidth: Math.max(minWidth, availableWidth) };
}

export function resolveDefaultExpandedMarkdownTableWidth(
  contentWidth: number,
  bounds: MarkdownTableWidthBounds,
): number {
  return clamp(
    contentWidth * MARKDOWN_TABLE_DEFAULT_EXPANSION_RATIO,
    bounds.minWidth,
    bounds.maxWidth,
  );
}

export function resolveDraggedMarkdownTableWidth(input: {
  readonly bounds: MarkdownTableWidthBounds;
  readonly deltaX: number;
  readonly edge: MarkdownTableResizeEdge;
  readonly startWidth: number;
}): number {
  const edgeDirection = input.edge === "right" ? 1 : -1;
  const centeredWidthDelta = input.deltaX * edgeDirection * 2;
  return clamp(input.startWidth + centeredWidthDelta, input.bounds.minWidth, input.bounds.maxWidth);
}
