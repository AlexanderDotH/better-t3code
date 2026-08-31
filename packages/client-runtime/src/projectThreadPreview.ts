export interface ProjectThreadPreviewInput<T> {
  readonly items: readonly T[];
  readonly count: number;
  readonly showAll: boolean;
  readonly alwaysVisible: (item: T) => boolean;
}

export interface ProjectThreadPreview<T> {
  readonly visibleItems: readonly T[];
  readonly hiddenItems: readonly T[];
  readonly hasOverflowingItems: boolean;
}

export interface ProjectThreadSectionsInput<T> {
  readonly items: readonly T[];
  readonly count: number;
  readonly showAllNonSettled: boolean;
  readonly showSettled: boolean;
  readonly isSettled: (item: T) => boolean;
  readonly alwaysVisible: (item: T) => boolean;
  readonly keepSettledVisible: (item: T) => boolean;
}

export interface ProjectThreadSections<T> {
  readonly nonSettledItems: readonly T[];
  readonly settledItems: readonly T[];
  readonly visibleNonSettledItems: readonly T[];
  readonly hiddenNonSettledItems: readonly T[];
  readonly visibleSettledItems: readonly T[];
  readonly hiddenSettledItems: readonly T[];
}

export function resolveProjectThreadPreview<T>(
  input: ProjectThreadPreviewInput<T>,
): ProjectThreadPreview<T> {
  if (input.showAll) {
    return {
      visibleItems: input.items,
      hiddenItems: [],
      hasOverflowingItems: false,
    };
  }

  const visibleItems: T[] = [];
  const hiddenItems: T[] = [];
  for (const [index, item] of input.items.entries()) {
    if (index < input.count || input.alwaysVisible(item)) {
      visibleItems.push(item);
      continue;
    }
    hiddenItems.push(item);
  }

  return {
    visibleItems,
    hiddenItems,
    hasOverflowingItems: hiddenItems.length > 0,
  };
}

export function resolveProjectThreadSections<T>(
  input: ProjectThreadSectionsInput<T>,
): ProjectThreadSections<T> {
  const priorityItems: T[] = [];
  const ordinaryNonSettledItems: T[] = [];
  const settledItems: T[] = [];
  for (const item of input.items) {
    if (input.alwaysVisible(item)) {
      priorityItems.push(item);
      continue;
    }
    if (input.isSettled(item)) {
      settledItems.push(item);
      continue;
    }
    ordinaryNonSettledItems.push(item);
  }
  const nonSettledItems = [...priorityItems, ...ordinaryNonSettledItems];

  const nonSettledPreview = resolveProjectThreadPreview({
    items: nonSettledItems,
    count: input.count,
    showAll: input.showAllNonSettled,
    alwaysVisible: input.alwaysVisible,
  });
  const visibleSettledItems: T[] = [];
  const hiddenSettledItems: T[] = [];
  for (const item of settledItems) {
    if (input.showSettled || input.keepSettledVisible(item)) {
      visibleSettledItems.push(item);
      continue;
    }
    hiddenSettledItems.push(item);
  }

  return {
    nonSettledItems,
    settledItems,
    visibleNonSettledItems: nonSettledPreview.visibleItems,
    hiddenNonSettledItems: nonSettledPreview.hiddenItems,
    visibleSettledItems,
    hiddenSettledItems,
  };
}
