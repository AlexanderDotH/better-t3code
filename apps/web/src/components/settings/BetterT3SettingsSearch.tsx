import { CHAT_VISUAL_MODES, type BetterT3FeatureControlStateV1 } from "@t3tools/contracts";
import { getBetterT3SettingsSubgroupForFeature } from "@t3tools/client-runtime/better-t3-settings-layout";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import { resolveBetterT3DescriptorMessageKeys } from "./BetterT3SettingsPanel.logic";
import type { SettingsSearchItem } from "./settingsSearch";

export function buildBetterT3FeatureSearchItems(
  features: ReadonlyArray<Pick<BetterT3FeatureControlStateV1, "descriptor">>,
  translate: InterfaceTranslator["message"],
): SettingsSearchItem[] {
  return features.flatMap((feature) => {
    const subgroup = getBetterT3SettingsSubgroupForFeature(feature.descriptor.id);
    if (!subgroup) return [];
    const messageIds = resolveBetterT3DescriptorMessageKeys(feature.descriptor);
    return [
      {
        id: feature.descriptor.id,
        targetId: feature.descriptor.id,
        to: "/settings/better-t3" as const,
        title: translate(messageIds.labelMessageId),
        description: translate(messageIds.descriptionMessageId),
        category: translate(`settings.betterT3.tab.${subgroup.categoryId}`),
        searchTerms: [
          translate(subgroup.titleMessageId),
          ...(feature.descriptor.id === "chat.presentation"
            ? CHAT_VISUAL_MODES.map((mode) => translate(`settings.chatVisuals.${mode}`))
            : []),
        ],
      },
    ];
  });
}
