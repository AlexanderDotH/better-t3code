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
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

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
  const translate = useInterfaceTranslator().message;
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
          <DialogTitle>
            {translate("chat.speechIndex.setupTitle", { project: projectTitle })}
          </DialogTitle>
          <DialogDescription>{translate("chat.speechIndex.description")}</DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-3" scrollFade={false}>
          {state === "idle" ? (
            <div
              aria-label={translate("chat.speechIndex.privacy")}
              className="rounded-xl border border-border/70 bg-muted/32 p-3 text-sm"
              data-testid="project-speech-preindex-privacy"
            >
              {translate("chat.speechIndex.privacyPrefix")}{" "}
              <span className="font-medium">{translate("chat.speechIndex.terminology")}</span>{" "}
              {translate("chat.speechIndex.privacySuffix")}
            </div>
          ) : null}

          {isBusy ? (
            <div
              aria-label={translate("chat.speechIndex.progress")}
              aria-live="polite"
              className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/32 p-3 text-sm"
              data-testid="project-speech-preindex-status"
              role="status"
            >
              <Spinner aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {isCreatingBasic
                  ? translate("chat.speechIndex.creatingBasic")
                  : translate("chat.speechIndex.indexing")}
              </span>
            </div>
          ) : null}

          {state === "basic" ? (
            <p className="rounded-xl border border-border/70 bg-muted/32 p-3 text-sm">
              {translate("chat.speechIndex.basicReady")}
            </p>
          ) : null}

          {state === "error" ? (
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/32 p-3 text-sm">
              <p
                className="text-destructive"
                data-testid="project-speech-preindex-error"
                role="alert"
              >
                {errorMessage ?? translate("chat.speechIndex.failed")}
              </p>
              <p>{translate("chat.speechIndex.basicFallback")}</p>
            </div>
          ) : null}
        </DialogPanel>

        <DialogFooter>
          {showsChoices ? (
            <>
              <Button
                aria-label={translate("chat.speechIndex.notNow")}
                data-testid="project-speech-preindex-skip"
                disabled={isBusy}
                size="sm"
                variant="ghost"
                onClick={onSkip}
              >
                {translate("chat.speechIndex.notNow")}
              </Button>
              <Button
                aria-label={translate("chat.speechIndex.basicContext")}
                data-testid="project-speech-preindex-basic"
                disabled={isBusy}
                size="sm"
                variant="outline"
                onClick={onUseBasic}
              >
                {translate("chat.speechIndex.basicContext")}
              </Button>
              <Button
                aria-label={translate("chat.speechIndex.indexProject")}
                data-testid="project-speech-preindex-index"
                disabled={isBusy}
                size="sm"
                onClick={onIndex}
              >
                {translate("chat.speechIndex.indexProject")}
              </Button>
            </>
          ) : (
            <Button
              aria-label={translate("common.close")}
              data-testid="project-speech-preindex-close"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {translate("common.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
