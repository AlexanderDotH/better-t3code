import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";
import { McpWorkspacePanel, type McpWorkspaceSection } from "./McpWorkspacePanel";

vi.mock("~/hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));

function Workspace() {
  const [section, setSection] = useState<McpWorkspaceSection>("servers");
  return (
    <McpWorkspacePanel
      activeSection={section}
      onActiveSectionChange={setSection}
      servers={<p>My servers</p>}
      skills={<p>My skills</p>}
      store={<p>Catalog</p>}
      runtime={<p>Diagnostics</p>}
    />
  );
}

it("keeps browsing separate from installed items and remembers the installed category", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Workspace />);
  });
  const text = () => JSON.stringify(renderer.toJSON());
  const click = async (label: string) => {
    const button = renderer.root
      .findAllByType("button")
      .find((button) => button.props.children === label);
    expect(button).toBeDefined();
    await act(async () => button!.props.onClick());
  };
  try {
    expect(text()).toContain("My servers");
    expect(text()).not.toContain("Catalog");
    await click("settings.mcp.store.skills");
    expect(text()).toContain("My skills");
    await click("settings.mcp.store.browse");
    expect(text()).toContain("Catalog");
    expect(text()).not.toContain("My skills");
    await click("settings.mcp.store.installed");
    expect(text()).toContain("My skills");
    await click("settings.mcp.store.diagnostics");
    expect(text()).toContain("Diagnostics");
    expect(text()).not.toContain("My skills");
  } finally {
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  }
});
