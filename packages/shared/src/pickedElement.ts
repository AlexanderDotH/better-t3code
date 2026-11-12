import type { PickedElementPayload } from "@t3tools/contracts";

interface ElementCapture {
  readonly pageUrl: string;
  readonly pageTitle: string | null;
  readonly tagName: string;
  readonly outerHTML: string;
  readonly pickedAt: string;
}

export interface PickedElementContext {
  readonly selector?: string | null;
  readonly htmlPreview?: string;
  readonly componentName?: string | null;
  readonly styles?: string;
  readonly stack?: ReadonlyArray<{
    readonly functionName?: string | null;
    readonly fileName?: string | null;
    readonly lineNumber?: number | null;
    readonly columnNumber?: number | null;
  }>;
}

const HTML_PREVIEW_FALLBACK_LIMIT = 500;

export function buildPickedElementPayload(
  capture: ElementCapture,
  context?: PickedElementContext | null,
): PickedElementPayload {
  const stack = (context?.stack ?? []).map((frame) => ({
    functionName: frame.functionName ?? null,
    fileName: frame.fileName ?? null,
    lineNumber: frame.lineNumber ?? null,
    columnNumber: frame.columnNumber ?? null,
  }));
  return {
    pageUrl: capture.pageUrl,
    pageTitle: capture.pageTitle?.trim() || null,
    tagName: capture.tagName.toLowerCase(),
    selector: context?.selector ?? null,
    htmlPreview: context?.htmlPreview ?? capture.outerHTML.slice(0, HTML_PREVIEW_FALLBACK_LIMIT),
    componentName: context?.componentName ?? null,
    source: stack[0] ?? null,
    stack,
    styles: context?.styles ?? "",
    pickedAt: capture.pickedAt,
  };
}
