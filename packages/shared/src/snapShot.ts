import type { SnapShotSource } from "@t3tools/contracts";

export interface SnapShotAccessibilityDetails {
  content: string;
  format: "json" | "text";
}

export function snapShotAccessibilityDetails(
  source: SnapShotSource,
): SnapShotAccessibilityDetails | undefined {
  if (source.accessibility?.format === "element-tree") {
    return {
      content: JSON.stringify(source.accessibility, null, 2),
      format: "json",
    };
  }

  const text =
    source.accessibility?.format === "flat-text"
      ? source.accessibility.text.trim()
      : source.accessibleText?.trim();
  return text ? { content: text, format: "text" } : undefined;
}

export function snapShotIncludesAccessibility(source: SnapShotSource): boolean {
  return Boolean(source.accessibility || source.accessibleText?.trim());
}
