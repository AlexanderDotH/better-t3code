import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { resolveThreadSidebarLayout, ThreadSidebarSelection } from "./ThreadSidebarSelection";

vi.mock("./Sidebar", () => ({
  default: () => <div data-testid="current-sidebar" />,
}));

vi.mock("./LegacySidebar", () => ({
  default: () => <div data-testid="classic-sidebar" />,
}));

describe("ThreadSidebarSelection", () => {
  it("keeps the current sidebar while legacy settings are disabled or hydrating", () => {
    const layout = resolveThreadSidebarLayout(false);
    const html = renderToStaticMarkup(<ThreadSidebarSelection layout={layout} />);

    expect(layout).toBe("current");
    expect(html).toContain('data-testid="current-sidebar"');
    expect(html).not.toContain('data-testid="classic-sidebar"');
  });

  it("mounts only the classic sidebar after an explicit legacy opt-in", () => {
    const layout = resolveThreadSidebarLayout(true);
    const html = renderToStaticMarkup(<ThreadSidebarSelection layout={layout} />);

    expect(layout).toBe("classic");
    expect(html).toContain('data-testid="classic-sidebar"');
    expect(html).not.toContain('data-testid="current-sidebar"');
  });
});
