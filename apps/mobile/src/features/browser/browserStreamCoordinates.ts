import type { PreviewAnnotationPoint, PreviewAnnotationRect } from "@t3tools/contracts";

interface Size {
  readonly width: number;
  readonly height: number;
}

export function browserStreamPoint(
  point: PreviewAnnotationPoint,
  view: Size & { readonly left: number; readonly top: number },
  frame: Size,
  viewport: Size | null,
): PreviewAnnotationPoint | null {
  if (
    !viewport ||
    ![view.width, view.height, frame.width, frame.height, viewport.width, viewport.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;
  const fit = Math.min(view.width / frame.width, view.height / frame.height);
  const width = frame.width * fit;
  const height = frame.height * fit;
  const x = ((point.x - view.left - (view.width - width) / 2) / width) * viewport.width;
  const y = ((point.y - view.top - (view.height - height) / 2) / height) * viewport.height;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= viewport.width ||
    y >= viewport.height
  )
    return null;
  return { x, y };
}

export function browserStreamRect(
  rect: PreviewAnnotationRect,
  frame: Size,
  viewport: Size,
): PreviewAnnotationRect {
  return {
    x: (rect.x * frame.width) / viewport.width,
    y: (rect.y * frame.height) / viewport.height,
    width: (rect.width * frame.width) / viewport.width,
    height: (rect.height * frame.height) / viewport.height,
  };
}
