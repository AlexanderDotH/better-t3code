import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { McpScopeFilterControls } from "./McpScopeFilterControls";

const projects = [
  { key: "local:better-t3code", name: "better-t3code" },
  { key: "remote:docs", name: "Docs" },
] as const;

describe("McpScopeFilterControls", () => {
  it("labels the scope selector and omits project selection for global scope", () => {
    const html = renderToStaticMarkup(
      <McpScopeFilterControls
        scope="global"
        projectKey="local:better-t3code"
        projects={projects}
        onProjectKeyChange={vi.fn()}
        onScopeChange={vi.fn()}
      />,
    );

    expect(html).toContain(">Scope<");
    expect(html).toContain('aria-label="Scope"');
    expect(html).not.toContain(">Project<");
    expect(html).not.toContain('aria-label="Project"');
  });

  it("shows a labeled project selector only for project scope", () => {
    const html = renderToStaticMarkup(
      <McpScopeFilterControls
        scope="project"
        projectKey="local:better-t3code"
        projects={projects}
        onProjectKeyChange={vi.fn()}
        onScopeChange={vi.fn()}
      />,
    );

    expect(html).toContain(">Scope<");
    expect(html).toContain(">Project<");
    expect(html).toContain('aria-label="Project"');
    expect(html).toContain("better-t3code");
  });
});
