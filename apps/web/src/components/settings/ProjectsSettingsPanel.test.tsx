import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ProjectsSettingsPanelView,
  type ProjectCheckpointSettingsGroup,
} from "./ProjectsSettingsPanel";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    "aria-label": ariaLabel,
    children,
    params,
  }: {
    readonly "aria-label"?: string;
    readonly children?: ReactNode;
    readonly params: { readonly projectKey: string };
  }) => (
    <a href={`/projects/${encodeURIComponent(params.projectKey)}`} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

vi.mock("./ProjectSettingsPanel", () => ({
  useSettingsProjectGroups: () => [],
}));

vi.mock("./settingsLayout", () => ({
  SettingsPageContainer: ({ children }: { readonly children?: ReactNode }) => (
    <main>{children}</main>
  ),
  SettingsSection: ({
    children,
    title,
  }: {
    readonly children?: ReactNode;
    readonly title: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SettingsRow: ({
    control,
    description,
    title,
  }: {
    readonly control?: ReactNode;
    readonly description?: ReactNode;
    readonly title: ReactNode;
  }) => (
    <article>
      <h3>{title}</h3>
      <p>{description}</p>
      {control}
    </article>
  ),
}));

describe("ProjectsSettingsPanelView", () => {
  it("shows each project's checkpoint state and a configuration link", () => {
    const groups: ReadonlyArray<ProjectCheckpointSettingsGroup> = [
      {
        projectKey: "large repo",
        displayName: "Large repo",
        memberProjects: [{ checkpointsEnabled: false }],
      },
      {
        projectKey: "grouped-repo",
        displayName: "Grouped repo",
        memberProjects: [{ checkpointsEnabled: true }, { checkpointsEnabled: true }],
      },
      {
        projectKey: "mixed-repo",
        displayName: "Mixed repo",
        memberProjects: [{ checkpointsEnabled: true }, { checkpointsEnabled: false }],
      },
    ];

    const markup = renderToStaticMarkup(<ProjectsSettingsPanelView groups={groups} />);

    expect(markup).toContain("Checkpoints");
    expect(markup).toContain("1 checkout · Checkpoints disabled");
    expect(markup).toContain("2 grouped checkouts · Checkpoints enabled");
    expect(markup).toContain("2 grouped checkouts · Checkpoints mixed");
    expect(markup).toContain('href="/projects/large%20repo"');
    expect(markup).toContain('aria-label="Configure checkpoints for Large repo"');
  });

  it("places harness chat sync before the existing project list", () => {
    const markup = renderToStaticMarkup(
      <ProjectsSettingsPanelView
        groups={[]}
        syncSettings={<section>Harness chat sync controls</section>}
      />,
    );

    expect(markup).toContain("Harness chat sync controls");
    expect(markup.indexOf("Harness chat sync controls")).toBeLessThan(
      markup.indexOf("Checkpoints"),
    );
  });
});
