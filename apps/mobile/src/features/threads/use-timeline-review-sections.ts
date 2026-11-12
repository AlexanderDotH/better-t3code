import type { ThreadId, TurnItemId } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { toolItemDiff } from "../../lib/toolItemDiff";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useReviewSections } from "../review/useReviewSections";
import type { ReviewSectionItem } from "../review/reviewModel";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export interface TimelineToolDiffTarget {
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly revision: string;
}

export function useTimelineReviewSections(
  input: Parameters<typeof useReviewSections>[0] & {
    readonly toolTarget?: TimelineToolDiffTarget;
  },
) {
  const translator = useMobileInterfaceTranslator();
  const standard = useReviewSections(input);
  const target = input.toolTarget;
  const key = target ? `tool:${target.threadId}:${target.itemId}:${target.revision}` : null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  const detail = useEnvironmentQuery(
    input.enabled !== false && input.environmentId && target
      ? orchestrationEnvironment.turnItem({ environmentId: input.environmentId, input: target })
      : null,
  );
  const item = detail.data?.item;
  const section = useMemo<ReviewSectionItem | null>(
    () =>
      key
        ? {
            id: key,
            kind: "turn",
            title:
              item?.type === "file_change"
                ? item.fileName
                : translator.message("mobile.timeline.openDiff"),
            subtitle: null,
            diff: item?.type === "file_change" ? toolItemDiff(item) : null,
            isLoading: detail.isPending,
          }
        : null,
    [key, item, detail.isPending, translator],
  );
  const selected = section !== null && dismissed !== key;
  return {
    ...standard,
    error: selected ? detail.error : standard.error,
    reviewSections: section ? [section, ...standard.reviewSections] : standard.reviewSections,
    selectedSection: selected ? section : standard.selectedSection,
    isSelectedSectionPending: selected ? detail.isPending : standard.isSelectedSectionPending,
    refreshSelectedSection: selected
      ? async () => {
          detail.refresh();
        }
      : standard.refreshSelectedSection,
    selectSection: (id: string) => {
      if (id === key) setDismissed(null);
      else {
        setDismissed(key);
        standard.selectSection(id);
      }
    },
  };
}
