import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/experimental")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings/better-t3",
      hash: "agent.fetch",
      replace: true,
    });
  },
});
