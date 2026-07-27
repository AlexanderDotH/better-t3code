import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ProjectSpeechPreindexDialog,
  type ProjectSpeechPreindexDialogState,
} from "./ProjectSpeechPreindexDialog";

vi.mock("../ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DialogDescription: (props: ComponentProps<"p">) => <p {...props} />,
  DialogFooter: (props: ComponentProps<"footer">) => <footer {...props} />,
  DialogHeader: (props: ComponentProps<"header">) => <header {...props} />,
  DialogPanel: ({
    scrollFade: _scrollFade,
    ...props
  }: ComponentProps<"div"> & {
    scrollFade?: boolean;
  }) => <div {...props} />,
  DialogPopup: ({
    children,
    showCloseButton = true,
    ...props
  }: ComponentProps<"section"> & { showCloseButton?: boolean }) => (
    <section {...props}>
      {children}
      {showCloseButton ? <button aria-label="Close" /> : null}
    </section>
  ),
  DialogTitle: (props: ComponentProps<"h2">) => <h2 {...props} />,
}));

function renderDialog(
  state: ProjectSpeechPreindexDialogState,
  options: { open?: boolean; errorMessage?: string } = {},
): string {
  return renderToStaticMarkup(
    <ProjectSpeechPreindexDialog
      open={options.open ?? true}
      projectTitle="Atlas"
      state={state}
      {...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage })}
      onIndex={vi.fn()}
      onUseBasic={vi.fn()}
      onSkip={vi.fn()}
      onOpenChange={vi.fn()}
    />,
  );
}

describe("ProjectSpeechPreindexDialog", () => {
  it("renders the idle privacy explanation and all choices", () => {
    const markup = renderDialog("idle");

    expect(markup).toContain('data-testid="project-speech-preindex-dialog"');
    expect(markup).toContain("Set up speech recognition for Atlas");
    expect(markup).toContain("project terminology and technology names");
    expect(markup).toContain("No source snippets are sent");

    for (const [testId, label] of [
      ["project-speech-preindex-index", "Index project"],
      ["project-speech-preindex-basic", "Use basic context"],
      ["project-speech-preindex-skip", "Not now"],
    ]) {
      expect(markup).toContain(`data-testid="${testId}"`);
      expect(markup).toContain(`aria-label="${label}"`);
    }
  });

  it("renders non-dismissible progress with every action disabled while indexing", () => {
    const markup = renderDialog("indexing");

    expect(markup).toContain('data-testid="project-speech-preindex-status"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Indexing project terminology and technology");
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
    expect(markup).not.toContain('aria-label="Close"');
  });

  it("describes basic-context creation while that action is pending", () => {
    const markup = renderDialog("creating-basic");

    expect(markup).toContain("Creating basic speech context");
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
    expect(markup).not.toContain('aria-label="Close"');
  });

  it("explains that basic context is active and offers Close", () => {
    const markup = renderDialog("basic");

    expect(markup).toContain("Basic speech context will be used");
    expect(markup).toContain('data-testid="project-speech-preindex-close"');
    expect(markup).toContain('aria-label="Close"');
    expect(markup).not.toContain('data-testid="project-speech-preindex-index"');
  });

  it("shows the indexing error and confirms the basic-context fallback", () => {
    const markup = renderDialog("error", { errorMessage: "Indexing timed out." });

    expect(markup).toContain('data-testid="project-speech-preindex-error"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Indexing timed out.");
    expect(markup).toContain("Basic speech context will be used instead");
    expect(markup).toContain('data-testid="project-speech-preindex-close"');
  });

  it("renders nothing when controlled closed", () => {
    expect(renderDialog("idle", { open: false })).toBe("");
  });
});
