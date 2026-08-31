import { createFileRoute } from "@tanstack/react-router";

import { BetterT3SettingsPanel } from "../components/settings/BetterT3SettingsPanel";

export const Route = createFileRoute("/settings/better-t3")({
  component: BetterT3SettingsPanel,
});
