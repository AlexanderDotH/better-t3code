import { DownloadIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { RelayClientInstallProgressStage } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

import {
  completeRelayClientInstallDialogClose,
  readRelayClientInstallDialogState,
  respondToRelayClientInstallConfirmation,
  subscribeRelayClientInstallDialog,
} from "../../cloud/relayClientInstallDialog";
import { Button } from "../ui/button";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
const installSteps: ReadonlyArray<{
  readonly stage: RelayClientInstallProgressStage;
  readonly label: InterfaceMessageKey;
}> = [
  { stage: "checking", label: "relayInstall.stage.checking" },
  { stage: "waiting_for_lock", label: "relayInstall.stage.waitingForLock" },
  { stage: "downloading", label: "relayInstall.stage.downloading" },
  { stage: "verifying", label: "relayInstall.stage.verifying" },
  { stage: "installing", label: "relayInstall.stage.installing" },
  { stage: "validating", label: "relayInstall.stage.validating" },
  { stage: "activating", label: "relayInstall.stage.activating" },
];

export function RelayClientInstallDialog() {
  const translator = useInterfaceTranslator();
  const state = useSyncExternalStore(
    subscribeRelayClientInstallDialog,
    readRelayClientInstallDialogState,
    readRelayClientInstallDialogState,
  );
  const view = state.status === "closing" ? state.view : state;
  const isConfirming = view.status === "confirming";
  const isInstalling = view.status === "installing";
  const activeStepIndex = isInstalling
    ? installSteps.findIndex(({ stage }) => stage === view.stage)
    : -1;
  const activeStep = installSteps[activeStepIndex];

  return (
    <Dialog
      open={state.status === "confirming" || state.status === "installing"}
      onOpenChange={(open) => {
        if (!open && isConfirming) {
          respondToRelayClientInstallConfirmation(false);
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open) {
          completeRelayClientInstallDialogClose();
        }
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton={isConfirming}>
        <DialogHeader>
          <div className="flex size-9 items-center justify-center rounded-lg border border-border/70 bg-muted/60">
            <DownloadIcon aria-hidden className="size-4.5 text-muted-foreground" />
          </div>
          <DialogTitle>
            {translator.message(
              isInstalling ? "relayInstall.stage.installing" : "relayInstall.confirmTitle",
            )}
          </DialogTitle>
          <DialogDescription>
            {isInstalling
              ? translator.message("relayInstall.installingDescription")
              : translator.message("relayInstall.confirmDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel scrollFade={false}>
          {isInstalling ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <p aria-live="polite" className="font-medium text-foreground">
                  {activeStep ? translator.message(activeStep.label) : null}
                </p>
                <p className="shrink-0 tabular-nums text-muted-foreground">
                  {translator.message("relayInstall.progressCount", {
                    current: activeStepIndex + 1,
                    total: installSteps.length,
                  })}
                </p>
              </div>
              <progress
                aria-label={translator.message("relayInstall.progressAria")}
                className="h-2 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
                max={installSteps.length}
                value={activeStepIndex + 1}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {translator.message("relayInstall.keepOpen")}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border/70 bg-muted/35 p-3">
              <p className="text-sm font-medium text-foreground">
                {translator.message("relayInstall.managedTitle")}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {translator.message("relayInstall.versionDescription", {
                  version: view.status === "confirming" ? view.version : "",
                })}
              </p>
            </div>
          )}
        </DialogPanel>
        {isConfirming ? (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => respondToRelayClientInstallConfirmation(false)}
            >
              {translator.message("common.cancel")}
            </Button>
            <Button onClick={() => respondToRelayClientInstallConfirmation(true)}>
              {translator.message("relayInstall.downloadAndInstall")}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
