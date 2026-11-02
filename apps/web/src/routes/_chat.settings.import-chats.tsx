import { createFileRoute } from "@tanstack/react-router";

import { ChatImportSettingsPanel } from "../components/settings/ChatImportSettings";

function SettingsImportChatsRoute() {
  return <ChatImportSettingsPanel />;
}

export const Route = createFileRoute("/_chat/settings/import-chats")({
  component: SettingsImportChatsRoute,
});
