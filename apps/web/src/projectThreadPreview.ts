import type { ProjectThreadPreviewCount } from "@t3tools/contracts";

export function resolveProjectThreadPreview<T>(input: {
  readonly items: ReadonlyArray<T>;
  readonly count: ProjectThreadPreviewCount;
  readonly showAll: boolean;
}): {
  readonly hasOverflowingItems: boolean;
  readonly visibleItems: ReadonlyArray<T>;
} {
  const hasOverflowingItems = input.items.length > input.count;
  return {
    hasOverflowingItems,
    visibleItems:
      input.showAll || !hasOverflowingItems ? input.items : input.items.slice(0, input.count),
  };
}
