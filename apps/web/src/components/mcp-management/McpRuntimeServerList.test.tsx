import {
  McpRuntimeServerKey,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  type McpRuntimeServer,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, cloneElement, useState, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { McpRuntimeServerList, type McpRuntimeServerListProps } from "./McpRuntimeServerList";

vi.mock("~/hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, undefined, children),
  TooltipPopup: () => null,
}));

function runtimeServer(name: string, state: McpRuntimeServer["state"]): McpRuntimeServer {
  return {
    providerKey: McpRuntimeServerKey.make(name),
    providerInstanceId: ProviderInstanceId.make("codex"),
    threadId: ThreadId.make("thread"),
    runtimeSessionId: RuntimeSessionId.make("runtime"),
    source: "provider-native",
    name,
    state,
    statusSource: "provider-query",
    observedAt: "2026-10-17T12:00:00.000Z",
    authState: "none",
    availableActions: ["reconnect"],
    reportsTools: true,
    toolCount: state === "connected" ? 8 : 0,
    configDrift: "none",
    ...(state === "failed" ? { issue: { message: "The server closed the connection." } } : {}),
  };
}

const healthy = runtimeServer("1password", "connected");
const failed = runtimeServer("notebooklm", "failed");
const onAction = vi.fn();
const onToggleDetails = vi.fn();

function Diagnostics() {
  const [details, setDetails] = useState<McpRuntimeServerListProps["detailsByProviderKey"]>({});
  return (
    <McpRuntimeServerList
      providerDisplayName="Codex"
      authorizationAvailable
      servers={[healthy, failed]}
      pendingAction={null}
      detailsByProviderKey={details}
      detailsLoadingKeys={new Set()}
      detailsErrorByProviderKey={{}}
      actionErrorByProviderKey={{}}
      onAction={onAction}
      onOpenSettings={vi.fn()}
      onToggleDetails={(server, expanded) => {
        onToggleDetails(server, expanded);
        if (expanded) {
          setDetails({
            [server.providerKey]: {
              tools: [{ name: "find_notes", title: "Find notes" }],
              resources: [],
              templates: [],
            },
          });
        }
      }}
    />
  );
}

it("keeps failures visible and recovery separate from expanding the server inventory", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onAction.mockClear();
  onToggleDetails.mockClear();
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<Diagnostics />);
    });
    const row = () => renderer!.root.findByProps({ "data-mcp-server-key": failed.providerKey });
    const toggle = () =>
      row()
        .findAllByType("button")
        .find((button) => button.props["aria-expanded"] !== undefined)!;
    const text = () => JSON.stringify(renderer!.toJSON());
    const rows = renderer!.root.findAll(
      (node) => node.type === "li" && node.props["data-mcp-server-key"] !== undefined,
    );
    expect(rows.map((node) => node.props["data-mcp-server-key"])).toEqual([
      failed.providerKey,
      healthy.providerKey,
    ]);
    expect(text()).toContain("The server closed the connection.");
    expect(text()).not.toContain("Find notes");
    expect(onToggleDetails).not.toHaveBeenCalled();

    const reconnect = row()
      .findAllByType("button")
      .find((button) => button.children.includes("Reconnect"))!;
    await act(() => reconnect.props.onClick());
    expect(onAction).toHaveBeenCalledWith(failed, "reconnect");
    expect(onToggleDetails).not.toHaveBeenCalled();
    expect(text()).not.toContain("Find notes");

    await act(() => toggle().props.onClick());
    expect(onToggleDetails).toHaveBeenLastCalledWith(failed, true);
    expect(text()).toContain("Find notes");
    await act(() => toggle().props.onClick());
    expect(onToggleDetails).toHaveBeenLastCalledWith(failed, false);
    expect(text()).not.toContain("Find notes");
    expect(text()).toContain("The server closed the connection.");
  } finally {
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
