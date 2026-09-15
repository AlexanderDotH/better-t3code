import { createFileRoute, redirect } from "@tanstack/react-router";

import { ConnectionsSettings } from "../components/settings/ConnectionsSettings";

export const Route = createFileRoute("/settings/connections")({
  beforeLoad: ({ location }) => {
    if (location.hash.replace(/^#/, "") === "voice-input") {
      throw redirect({ to: "/settings/better-t3", hash: "better-t3-group-voice", replace: true });
    }
  },
  component: ConnectionsSettings,
});
