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
  it("renders active progress as an attached composer tab", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        progress={progress}
        steps={steps}
      />,
    );

    expect(markup).toContain('data-composer-tasks-badge="true"');
    expect(markup).toContain('data-variant="info"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("chat-composer-shoulder-tab");
    expect(markup).toContain("chat-composer-tasks-tab");
    expect(markup).toContain("rounded-t-xl");
    expect(markup).toContain("border-b-0");
    expect(markup).toContain("left-4");
    expect(markup).toContain("right-4");
    expect(markup).toContain("px-3");
    expect(markup).toContain('data-composer-task-current="true"');
    expect(markup).toContain("min-w-0 flex-1 truncate");
    expect(markup).toContain("w-20");
    expect(markup).toContain("Tasks");
    expect(markup).toContain("Attach task progress");
    expect(markup).not.toContain("·");
    expect(markup).toContain("1/3");
    expect(markup).toContain("Current task: Attach task progress");
    expect(markup).toContain("lucide-list-todo");
    expect(markup).toContain("text-info");
    expect(markup).toContain('aria-label="Dismiss tasks for this turn"');
    expect(markup).toContain("lucide-x");
    expect(markup).not.toContain("lucide-chevron");
    expect(markup).toContain("bg-success");
    expect(markup).toContain("bg-info");
    expect(markup).toContain("bg-muted-foreground/25");
  });

  it("leaves room for the stash tab when both shoulders are present", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        hasTrailingShoulder
        onDismiss={() => undefined}
        onToggle={() => undefined}
        progress={progress}
        steps={steps}
      />,
    );

    expect(markup).toContain("right-28");
    expect(markup).not.toContain("right-4");
  });

  it("has a compact inline fallback for occupied composer shoulders", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        placement="inline"
        progress={progress}
        steps={steps}
      />,
    );

    expect(markup).toContain("rounded-sm");
    expect(markup).toContain("1/3");
    expect(markup).not.toContain("chat-composer-shoulder-tab");
    expect(markup).not.toContain("rounded-t-xl");
  });

  it("keeps compact progress inside a narrow detached floating island", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        placement="floating"
        progress={progress}
        steps={steps}
      />,
    );

    const rootClassName = markup.match(/^<div class="([^"]+)"/)?.[1];
    expect(markup).toContain("chat-composer-top-drawer-floating");
    expect(markup).toContain('data-composer-task-current="true"');
    expect(markup).toContain('data-variant="info"');
    expect(rootClassName).toContain("min-h-10");
    expect(rootClassName).toContain("min-w-0");
    expect(rootClassName).toContain("gap-2");
    expect(rootClassName).toContain("px-3");
    expect(rootClassName).toContain("py-2");
    expect(rootClassName).toContain("sm:px-5");
    expect(markup).toContain("sm:w-20");
    expect(markup).not.toContain("chat-composer-shoulder-tab");
    expect(markup).not.toContain("border-b-0");
    expect(rootClassName).not.toContain("absolute");
  });

  it("expands into a read-only floating task list", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksDrawer
        onCollapse={() => undefined}
        onDismiss={() => undefined}
        progress={progress}
        steps={steps}
      />,
    );

    expect(markup).toContain('data-chat-composer-tasks-drawer="true"');
    expect(markup).toContain("chat-composer-top-drawer-floating");
    expect(markup).toContain('data-variant="info"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("1 of 3 complete");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="1"');
    expect(markup).toContain('aria-valuemax="3"');
    expect(markup).toContain('<ol aria-label="Task progress steps"');
    expect(markup).toContain('data-composer-task-status="completed"');
    expect(markup).toContain('data-composer-task-status="inProgress"');
    expect(markup).toContain('data-composer-task-status="pending"');
    expect(markup).toContain("ring-info/20");
    expect(markup).toContain("bg-info/10");
    expect(markup).toContain("text-info");
    expect(markup).not.toContain("bg-primary/10");
    expect(markup).not.toContain("ring-primary/20");
    expect(markup).toContain("px-4");
    expect(markup).toContain("sm:px-5");
    expect(markup).toContain("mx-4");
    expect(markup).toContain("sm:mx-5");
    expect(markup).toContain("max-h-[min(20rem,45vh)]");
    expect(markup).toContain("Inspect the composer");
    expect(markup).toContain('data-composer-task-duration="true"');
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("4.0s");
    expect(markup).toContain("Now");
    expect(markup).toContain("Attach task progress");
    expect(markup).toContain("Verify the result");
    expect(markup).toContain("lucide-list-todo");
    expect(markup).toContain("lucide-check");
    expect(markup).toContain("lucide-circle-dot");
    expect(markup).toContain("lucide-circle");
    expect(markup).toContain('aria-label="Dismiss tasks for this turn"');
    expect(markup).not.toContain("lucide-chevron");
    expect(markup).not.toContain(">✓<");
    expect(markup).not.toContain(">●<");
    expect(markup).not.toContain(">○<");
  });

  it("does not render an empty task count", () => {
    const markup = renderToStaticMarkup(
      <ComposerTasksBadge
        expanded={false}
        onDismiss={() => undefined}
        onToggle={() => undefined}
        progress={{ ...progress, totalSteps: 0 }}
        steps={steps}
      />,
    );

    expect(markup).toBe("");
  });
});
