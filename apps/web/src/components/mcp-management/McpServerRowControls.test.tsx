import type { McpRuntimeState } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { createMcpServerRowActionModel, McpServerRowControls } from "./McpServerRowControls";

const reconnectStates: ReadonlyArray<McpRuntimeState> = [
  "failed",
  "stale",
  "not-started",
  "unknown",
];

describe("createMcpServerRowActionModel", () => {
  it.each(["auth-required", "setup-required"] as const)(
    "uses Authorize as the primary action for %s servers",
    (state) => {
      const model = createMcpServerRowActionModel({
        state,
        availableRuntimeActions: ["authorize", "reconnect", "refresh"],
      });

      expect(model.primaryAction?.key).toBe("authorize");
      expect(model.menuActions.map((action) => action.key)).toEqual(["refresh", "reconnect"]);
    },
  );

  it.each(reconnectStates)("uses Reconnect as the primary action for %s servers", (state) => {
    const model = createMcpServerRowActionModel({
      state,
      availableRuntimeActions: ["reconnect", "refresh"],
    });

    expect(model.primaryAction?.key).toBe("reconnect");
    expect(model.menuActions.map((action) => action.key)).toEqual(["refresh"]);
  });

  it("keeps connected-server runtime mutations in the overflow menu", () => {
    const model = createMcpServerRowActionModel({
      state: "connected",
      availableRuntimeActions: ["reconnect", "refresh"],
      configurationActions: ["edit", "duplicate", "delete"],
    });

    expect(model.primaryAction).toBeNull();
    expect(model.menuActions.map((action) => action.key)).toEqual([
      "refresh",
      "reconnect",
      "edit",
      "duplicate",
      "delete",
    ]);
    expect(model.menuActions.at(-1)?.destructive).toBe(true);
  });
});

describe("McpServerRowControls", () => {
  it("labels the provider-enable switch and keeps the actions menu separate", () => {
    const html = renderToStaticMarkup(
      <McpServerRowControls
        serverKey="notion"
        serverName="Notion"
        state="connected"
        availableRuntimeActions={["reconnect", "refresh"]}
        pendingAction={null}
        readOnly={false}
        providerAssignment={{
          enabled: true,
          disabled: false,
          pending: false,
          onChange: vi.fn(),
        }}
        onRuntimeAction={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(html).toContain(">Enabled<");
    expect(html).toContain('aria-label="Disable Notion for selected provider"');
    expect(html).toContain('aria-label="Actions for Notion"');
  });

  it("only marks the exact pending server row as busy", () => {
    const pending = { serverKey: "notion", action: "reconnect" } as const;
    const notion = renderToStaticMarkup(
      <McpServerRowControls
        serverKey="notion"
        serverName="Notion"
        state="failed"
        availableRuntimeActions={["reconnect", "refresh"]}
        pendingAction={pending}
        readOnly={false}
        onRuntimeAction={vi.fn()}
      />,
    );
    const slack = renderToStaticMarkup(
      <McpServerRowControls
        serverKey="slack"
        serverName="Slack"
        state="failed"
        availableRuntimeActions={["reconnect", "refresh"]}
        pendingAction={pending}
        readOnly={false}
        onRuntimeAction={vi.fn()}
      />,
    );

    expect(notion).toContain('role="status"');
    expect(notion).toContain("Reconnecting Notion");
    expect(notion).toContain('disabled=""');
    expect(slack).not.toContain('role="status"');
    expect(slack).not.toContain('disabled=""');
  });
});
