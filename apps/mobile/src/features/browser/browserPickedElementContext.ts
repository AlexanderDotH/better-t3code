import type {
  ElementContextDetails,
  ImageContextRecord,
  PreviewAnnotationContextRecord,
  PreviewPickElementResult,
} from "@t3tools/contracts";
import {
  formatComposerContextReference,
  sanitizeComposerContextLabel,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";

export function browserPickedElementContext(
  picked: NonNullable<PreviewPickElementResult>,
  screenshot: { readonly id: string; readonly name: string; readonly sizeBytes: number },
  annotationId: string,
) {
  const raw = picked.element;
  const element: ElementContextDetails = {
    pageUrl: raw.pageUrl,
    pageTitle: raw.pageTitle,
    tagName: raw.tagName,
    selector: raw.selector,
    htmlPreview: raw.htmlPreview.slice(0, 4000),
    componentName: raw.componentName,
    source: raw.source ?? raw.stack[0] ?? null,
    styles: raw.styles.slice(0, 4000),
  };
  const image: ImageContextRecord = {
    version: 1,
    kind: "image",
    contextId: toKindScopedComposerContextId("image", screenshot.id),
    label: screenshot.name,
    attachmentId: screenshot.id,
    name: screenshot.name,
    mimeType: "image/png",
    sizeBytes: screenshot.sizeBytes,
  };
  const annotation: PreviewAnnotationContextRecord = {
    version: 1,
    kind: "preview-annotation",
    contextId: toKindScopedComposerContextId("preview-annotation", annotationId),
    label: sanitizeComposerContextLabel(
      raw.componentName || raw.selector || raw.tagName,
      "preview-annotation",
    ),
    annotationId,
    pageUrl: raw.pageUrl,
    pageTitle: raw.pageTitle,
    comment: "",
    targetSummary: raw.tagName,
    elements: [element],
    elementIds: [annotationId],
    styleChanges: [],
    screenshotContextId: image.contextId,
  };
  return {
    text: formatComposerContextReference(annotation),
    context: { version: 1 as const, records: [annotation, image] },
  };
}
