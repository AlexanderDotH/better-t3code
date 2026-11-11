import {
  BETTER_T3_SETTINGS_CATEGORY_IDS,
  resolveBetterT3SettingsCategoryForTarget,
  type BetterT3SettingsCategoryId,
} from "@t3tools/client-runtime/better-t3-settings-layout";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { BetterT3SettingsPanel } from "../components/settings/BetterT3SettingsPanel";

function validateBetterT3Search(search: Record<string, unknown>): {
  readonly category?: BetterT3SettingsCategoryId;
} {
  const category = BETTER_T3_SETTINGS_CATEGORY_IDS.find((id) => id === search.category);
  return category === undefined ? {} : { category };
}

function BetterT3SettingsRoute() {
  const { category } = Route.useSearch();
  return <BetterT3SettingsPanel category={category ?? BETTER_T3_SETTINGS_CATEGORY_IDS[0]!} />;
}

export const Route = createFileRoute("/_chat/settings/better-t3")({
  validateSearch: validateBetterT3Search,
  beforeLoad: ({ search, location }) => {
    // Deep links name a setting, so its category decides which page opens.
    const category =
      resolveBetterT3SettingsCategoryForTarget(location.hash.replace(/^#/, "")) ??
      search.category ??
      BETTER_T3_SETTINGS_CATEGORY_IDS[0]!;
    if (category === search.category) return;
    throw redirect({
      to: "/settings/better-t3",
      search: { ...search, category },
      hash: true,
      replace: true,
    });
  },
  component: BetterT3SettingsRoute,
});
