import type { ProjectThreadSections } from "@t3tools/client-runtime/project-thread-preview";

export interface LegacySidebarProjectThreadDisclosureInput<T> {
  readonly sections: ProjectThreadSections<T>;
  readonly isThreadListExpanded: boolean;
  readonly settledThreadsVisible: boolean;
  readonly pinnedCollapsedThread?: T | null;
}

export interface LegacySidebarProjectThreadDisclosure<T> {
  readonly renderedThreads: readonly T[];
  readonly hasOverflowingThreads: boolean;
  readonly canToggleSettledThreads: boolean;
  readonly canShowLess: boolean;
}

export function resolveLegacySidebarProjectThreadDisclosure<T>(
  input: LegacySidebarProjectThreadDisclosureInput<T>,
): LegacySidebarProjectThreadDisclosure<T> {
  const { sections } = input;
  const hasHiddenNonSettledThreads = sections.hiddenNonSettledItems.length > 0;
  const nonSettledThreads = input.isThreadListExpanded
    ? sections.nonSettledItems
    : sections.visibleNonSettledItems;
  const showAllSettledThreads =
    input.settledThreadsVisible && (input.isThreadListExpanded || !hasHiddenNonSettledThreads);
  const settledThreads = showAllSettledThreads
    ? sections.settledItems
    : sections.visibleSettledItems;
  const hasPinnedCollapsedThread =
    input.pinnedCollapsedThread !== null && input.pinnedCollapsedThread !== undefined;

  return {
    renderedThreads: hasPinnedCollapsedThread
      ? [input.pinnedCollapsedThread]
      : [...nonSettledThreads, ...settledThreads],
    hasOverflowingThreads: !input.isThreadListExpanded && hasHiddenNonSettledThreads,
    canToggleSettledThreads: input.settledThreadsVisible
      ? sections.settledItems.length > 0
      : sections.hiddenSettledItems.length > 0,
    canShowLess:
      input.isThreadListExpanded ||
      (input.settledThreadsVisible && sections.settledItems.length > 0),
  };
}
