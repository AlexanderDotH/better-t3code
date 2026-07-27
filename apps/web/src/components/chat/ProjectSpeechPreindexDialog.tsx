"use client";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";

export type ProjectSpeechPreindexDialogState =
  | "idle"
  | "indexing"
  | "creating-basic"
  | "basic"
  | "error";

export interface ProjectSpeechPreindexDialogProps {
  open: boolean;
  projectTitle: string;
  state: ProjectSpeechPreindexDialogState;
  errorMessage?: string;
  onIndex: () => void;
  onUseBasic: () => void;
  onSkip: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ProjectSpeechPreindexDialog({
  open,
  projectTitle,
  state,
  errorMessage,
  onIndex,
  onUseBasic,
  onSkip,
  onOpenChange,
}: ProjectSpeechPreindexDialogProps) {
  const isIndexing = state === "indexing";
  const isCreatingBasic = state === "creating-basic";
  const isBusy = isIndexing || isCreatingBasic;
  const showsChoices = state === "idle" || isBusy;

  return (
    <Dialog
      open={open}
      disablePointerDismissal={isBusy}
      onOpenChange={(nextOpen) => {
        if (!isBusy) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup
        className="max-w-md"
        data-testid="project-speech-preindex-dialog"
        showCloseButton={!isBusy}
      >
        <DialogHeader>
          <DialogTitle>Set up speech recognition for {projectTitle}</DialogTitle>
          <DialogDescription>
            Give AssemblyAI a small vocabulary tailored to this project.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-3" scrollFade={false}>
          {state === "idle" ? (
            <div
              aria-label="AssemblyAI indexing privacy"
              className="rounded-xl border border-border/70 bg-muted/32 p-3 text-sm"
              data-testid="project-speech-preindex-privacy"
            >
              Indexing extracts only{" "}
              <span className="font-medium">project terminology and technology names</span> for
              AssemblyAI. No source snippets are sent.
            </div>
          ) : null}

          {isBusy ? (
            <div
              aria-label="Project indexing progress"
              aria-live="polite"
              className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/32 p-3 text-sm"
              data-testid="project-speech-preindex-status"
              role="status"
            >
              <Spinner aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {isCreatingBasic
                  ? "Creating basic speech context from project metadata."
                  : "Indexing project terminology and technology names. No source snippets are sent."}
              </span>
            </div>
          ) : null}

          {state === "basic" ? (
            <p className="rounded-xl border border-border/70 bg-muted/32 p-3 text-sm">
              Basic speech context will be used for AssemblyAI. You can index this project later.
            </p>
          ) : null}

          {state === "error" ? (
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/32 p-3 text-sm">
              <p
                className="text-destructive"
                data-testid="project-speech-preindex-error"
                role="alert"
              >
                {errorMessage ?? "Project indexing could not be completed."}
              </p>
              <p>Basic speech context will be used instead.</p>
            </div>
          ) : null}
        </DialogPanel>

        <DialogFooter>
          {showsChoices ? (
            <>
              <Button
                aria-label="Not now"
                data-testid="project-speech-preindex-skip"
                disabled={isBusy}
                size="sm"
                variant="ghost"
                onClick={onSkip}
              >
                Not now
              </Button>
              <Button
                aria-label="Use basic context"
                data-testid="project-speech-preindex-basic"
                disabled={isBusy}
                size="sm"
                variant="outline"
                onClick={onUseBasic}
              >
                Use basic context
              </Button>
              <Button
                aria-label="Index project"
                data-testid="project-speech-preindex-index"
                disabled={isBusy}
                size="sm"
                onClick={onIndex}
              >
                Index project
              </Button>
            </>
          ) : (
            <Button
              aria-label="Close"
              data-testid="project-speech-preindex-close"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
