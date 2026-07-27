import { createFileRoute } from "@tanstack/react-router";

import { McpServersSettingsPanel } from "../components/settings/McpServersSettings";

function SettingsMcpRoute() {
  return <McpServersSettingsPanel />;
}

export const Route = createFileRoute("/settings/mcp")({
  component: SettingsMcpRoute,
});
