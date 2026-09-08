import { createFileRoute } from "@tanstack/react-router";

import { McpServersSettingsPanel } from "../components/settings/McpServersSettings";
import { normalizeMcpSettingsSearch } from "../components/settings/McpServersSettings.logic";

function SettingsMcpRoute() {
  const search = Route.useSearch();
  return <McpServersSettingsPanel search={search} />;
}

export const Route = createFileRoute("/settings/mcp")({
  validateSearch: normalizeMcpSettingsSearch,
  component: SettingsMcpRoute,
});
