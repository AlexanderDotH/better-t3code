import type { useReviewHeaderPresentation as useIosReviewHeaderPresentation } from "./useReviewHeaderPresentation";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function useReviewHeaderPresentation(
  props: Parameters<typeof useIosReviewHeaderPresentation>[0],
): ReturnType<typeof useIosReviewHeaderPresentation> {
  const translator = useMobileInterfaceTranslator();
  return {
    title: translator.message("mobile.review.changes"),
    subtitle: props.androidSubtitle || translator.message("mobile.ui.selectADiff"),
    gitMenu: null,
    menuIcon: "ellipsis.circle",
    refreshAction: {
      id: "refresh",
      title: translator.message("mobile.review.refreshDiff"),
      disabled: !props.selectedSection || props.selectedSection.isLoading,
      onPress: () => {
        void props.onRefresh();
      },
    },
  };
}
