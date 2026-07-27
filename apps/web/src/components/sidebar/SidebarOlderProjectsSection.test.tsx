import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SidebarMenu, SidebarMenuItem } from "../ui/sidebar";
import { SidebarOlderProjectsSection } from "./SidebarOlderProjectsSection";

describe("SidebarOlderProjectsSection", () => {
  it("renders nothing when there are no older projects", () => {
    expect(
      renderToStaticMarkup(
        <SidebarOlderProjectsSection count={0} open={false} onOpenChange={() => {}}>
          <span>Hidden</span>
        </SidebarOlderProjectsSection>,
      ),
    ).toBe("");
  });

  it("renders the label, count, tooltip, and collapsed accessible state without mounting content", () => {
    const html = renderToStaticMarkup(
      <SidebarOlderProjectsSection count={3} open={false} onOpenChange={() => {}}>
        <SidebarMenu>
          <SidebarMenuItem>Project</SidebarMenuItem>
        </SidebarMenu>
      </SidebarOlderProjectsSection>,
    );

    expect(html).toContain("Older projects");
    expect(html).toContain(">3<");
    expect(html).toContain("No work activity for at least 7 days.");
    expect(html).toContain('data-testid="sidebar-older-projects-trigger"');
    expect(html).not.toContain('data-testid="sidebar-older-projects-panel"');
    expect(html).not.toContain(">Project<");
    expect(html).toContain('aria-expanded="false"');
  });

  it("renders expanded content with the normal sidebar menu structure", () => {
    const html = renderToStaticMarkup(
      <SidebarOlderProjectsSection count={1} open onOpenChange={() => {}}>
        <SidebarMenu>
          <SidebarMenuItem>Old project</SidebarMenuItem>
        </SidebarMenu>
      </SidebarOlderProjectsSection>,
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-slot="sidebar-menu"');
    expect(html).toContain('data-slot="sidebar-menu-item"');
    expect(html).toContain("Old project");
  });
});
