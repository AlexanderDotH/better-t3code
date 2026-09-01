import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerTasksBadge, ComposerTasksDrawer } from "./ComposerTasksBadge";

const progress = {
  step: "Attach task progress",
  completedSteps: 1,
  totalSteps: 3,
};

const steps = [
  { durationMs: 4_000, step: "Inspect the composer", status: "completed" as const },
  { step: "Attach task progress", status: "inProgress" as const },
  { step: "Verify the result", status: "pending" as const },
];

describe("ComposerTasksBadge", () => {
  it("renders active progress as a disclosure in the attached composer dock", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onToggle={() => undefined}
        progress={progress}
        steps={steps}
      />,
    );

    expect(markup).toContain('data-composer-tasks-badge="true"');
    expect(markup).toContain('data-composer-shoulder-tab="true"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-composer-task-current="true"');
    expect(markup).toContain("Attach task progress");
    expect(markup).toContain("1/3");
    expect(markup).toContain("bg-success");
    expect(markup).toContain("bg-primary");
    expect(markup).toContain("bg-muted-foreground/25");
  });

  it("keeps live input and output tokens visible when tasks host the activity status", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        activityStatus={{
          kind: "working",
          startedAt: null,
          inputTokens: 2_400,
          outputTokens: 120,
        }}
        expanded={false}
        onToggle={() => undefined}
        progress={progress}
        steps={steps}
      />,
    );

    expect(markup).toContain('data-composer-token-direction="input"');
    expect(markup).toContain('data-composer-token-direction="output"');
    expect(markup).toContain("2.4k");
    expect(markup).toContain("120");
  });

  it("renders the inline variant without a second attached surface", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onToggle={() => undefined}
        placement="inline"
        progress={progress}
        steps={steps}
      />,
    );

    expect(markup).toContain('data-composer-tasks-badge="true"');
    expect(markup).not.toContain("data-composer-shoulder-tab");
    expect(markup).not.toContain('data-slot="composer-banner"');
  });

  it("expands into a bounded, accessible task list", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksDrawer onCollapse={() => undefined} progress={progress} steps={steps} />,
    );

    expect(markup).toContain('data-chat-composer-tasks-drawer="true"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('data-composer-tasks-scroll="true"');
    expect(markup).toContain('data-composer-tasks-list="true"');
    expect(markup).toContain("Inspect the composer");
    expect(markup).toContain("Attach task progress");
    expect(markup).toContain("Verify the result");
    expect(markup).toContain("4.0s");
    expect(markup).toContain("Now");
  });

  it("does not render an empty task count", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onToggle={() => undefined}
        progress={{ ...progress, totalSteps: 0 }}
        steps={steps}
      />,
    );

    expect(markup).toBe("");
  });
});
