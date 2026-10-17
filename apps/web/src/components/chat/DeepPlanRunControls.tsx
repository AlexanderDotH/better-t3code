import { useRef, useState } from "react";
import type { DeepPlanRun } from "@t3tools/contracts";
import { selectDeepPlanProgress } from "@t3tools/client-runtime/deep-planning";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";

export function DeepPlanRunControls({
  run,
  disabled,
  canContinue = false,
  onResume,
  onFinalValidation,
}: {
  run: DeepPlanRun;
  disabled: boolean;
  canContinue?: boolean;
  onResume: () => Promise<void>;
  onFinalValidation: () => Promise<void>;
}) {
  const translate = useInterfaceTranslator().message;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const progress = selectDeepPlanProgress(run);
  const resumable =
    ["paused", "failed", "blocked"].includes(run.phase) ||
    (canContinue &&
      ["collecting", "planning", "implementing", "validating"].includes(run.phase) &&
      !progress.allStepsVerified);
  const canValidate =
    progress.allStepsVerified &&
    run.approval !== null &&
    run.finalValidation.status !== "passed" &&
    run.finalValidation.status !== "inProgress";
  if (!resumable && !canValidate) return null;
  const perform = async (operation: () => Promise<void>) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : translate("chat.deepPlan.resumeFailed"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root variant={resumable || error ? "warning" : "default"}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          {run.pauseReason ? (
            <p className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
              {run.pauseReason}
            </p>
          ) : null}
          {resumable ? (
            <Button
              variant="outline"
              disabled={disabled || busy}
              onClick={() => void perform(onResume)}
            >
              {translate(busy ? "chat.deepPlan.resuming" : "chat.deepPlan.resume")}
            </Button>
          ) : canValidate ? (
            <Button
              variant="outline"
              disabled={disabled || busy}
              onClick={() => void perform(onFinalValidation)}
            >
              {translate("chat.deepPlan.startFinalValidation")}
            </Button>
          ) : null}
          {error ? (
            <p role="alert" className="w-full text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
