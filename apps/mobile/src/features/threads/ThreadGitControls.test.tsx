import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({ navigate: vi.fn(), openPullRequest: vi.fn() }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: harness.navigate }),
}));
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("../../localization/useMobileInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useMobileInterfaceTranslator: () =>
      createInterfaceTranslator({ language: "en", locale: "en-US" }),
  };
});
vi.mock("../../native/useOpenPullRequest", () => ({
  useOpenPullRequest: () => harness.openPullRequest,
}));
vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn(), confirm: vi.fn() }));
vi.mock("../../components/ui/Toolbar", () => ({ Toolbar: () => null }));
vi.mock("../../components/ui/nativeHeaderMenu.ios", () => ({ createNativeHeaderMenu: () => null }));

import { useThreadGitRightHeaderItems, useThreadGitMenuDefinition } from "./ThreadGitControls";

it("removes Git actions when disabled while keeping graph, files and terminal reachable", () => {
  harness.navigate.mockReset();
  harness.openPullRequest.mockReset();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const openGraph = vi.fn();
  const openGit = vi.fn();
  const props = {
    environmentId: "environment",
    threadId: "thread",
    currentBranch: "main",
    gitStatus: null,
    gitOperationLabel: null,
    canOpenTerminal: true,
    canOperateTerminal: true,
    canOpenFiles: true,
    projectScripts: [],
    terminalSessions: [],
    onOpenTerminal: vi.fn(),
    onOpenNewTerminal: vi.fn(),
    onRunProjectScript: async () => {},
    onPull: async () => {},
    onRunAction: async () => null,
    onOpenGitInspector: openGit,
    knowledgeGraphControl: { accessibilityLabel: "Knowledge graph", onPress: openGraph },
  };
  let items: ReturnType<typeof useThreadGitRightHeaderItems> = [];
  let menu: ReturnType<typeof useThreadGitMenuDefinition> = null;
  function Probe({ enabled }: { enabled: boolean }) {
    const controls = { ...props, gitEnabled: enabled };
    const current = useThreadGitRightHeaderItems(controls);
    const currentMenu = useThreadGitMenuDefinition(controls);
    useLayoutEffect(() => {
      items = current;
      menu = currentMenu;
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  using _root = { [Symbol.dispose]: () => act(() => root.unmount()) };
  act(() => root.render(<Probe enabled />));
  expect(menu).not.toBeNull();
  act(() => root.render(<Probe enabled={false} />));
  expect(menu).toBeNull();
  expect(items.map((item) => item.accessibilityLabel)).toEqual([
    "Knowledge graph",
    "Open files",
    "Open terminal",
  ]);
  act(() => (items[0]!.onPress as () => void)());
  expect(openGraph).toHaveBeenCalledOnce();
  expect(openGit).not.toHaveBeenCalled();
  expect(harness.navigate).not.toHaveBeenCalled();
  act(() => root.render(<Probe enabled />));
  expect(items.some((item) => item.accessibilityLabel === "Git actions")).toBe(true);
  expect(menu).not.toBeNull();
});
