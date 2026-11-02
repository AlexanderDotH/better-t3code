import { ComposerContextId, type ComposerContextRecord } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { resolvePreviewAnnotationImage } from "./TimelineUserMessageRow.logic";

it("resolves an annotation screenshot through its image context record", () => {
  const image = {
    type: "image" as const,
    id: "thread-1-screenshot",
    name: "capture.png",
    mimeType: "image/png",
    sizeBytes: 42,
  };
  const annotation = {
    version: 1 as const,
    contextId: ComposerContextId.make("annotation-1"),
    kind: "preview-annotation" as const,
    label: "Checkout button",
    annotationId: "producer-id",
    pageUrl: "https://example.test/checkout",
    pageTitle: "Checkout",
    comment: "This changed after clicking",
    targetSummary: "1 selected element",
    styleChanges: [],
    screenshotContextId: ComposerContextId.make("screenshot-1"),
  };
  const screenshotRecord = {
    version: 1 as const,
    contextId: ComposerContextId.make("screenshot-1"),
    kind: "image" as const,
    label: "capture.png",
    attachmentId: image.id,
    name: image.name,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
  };

  expect(
    resolvePreviewAnnotationImage({
      record: annotation,
      recordsById: new Map<string, ComposerContextRecord>([
        [annotation.contextId, annotation],
        [screenshotRecord.contextId, screenshotRecord],
      ]),
      userImages: [image],
      previewImages: [],
      annotationRecordIds: [annotation.contextId],
    }),
  ).toBe(image);
});

it("returns no annotation screenshot when its binding cannot be resolved", () => {
  expect(
    resolvePreviewAnnotationImage({
      record: {
        version: 1,
        contextId: ComposerContextId.make("annotation-1"),
        kind: "preview-annotation",
        label: "Google",
        annotationId: "producer-id",
        pageUrl: "https://google.com",
        pageTitle: "Google",
        comment: "What is this?",
        targetSummary: "8 drawings",
        styleChanges: [],
        screenshotContextId: "missing-image" as never,
      },
      recordsById: new Map(),
      userImages: [],
      previewImages: [],
      annotationRecordIds: ["annotation-1"],
    }),
  ).toBeNull();
});
