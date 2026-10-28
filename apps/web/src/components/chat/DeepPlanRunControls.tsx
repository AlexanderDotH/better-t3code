import { useCallback, useEffect, useRef, useState } from "react";
import type { DeepPlanRun, EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import {
  selectDeepPlanProgress,
  shouldAutoContinueDeepPlan,
} from "@t3tools/client-runtime/deep-planning";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";
import { DeepPlanChecklist } from "./DeepPlanProgress";

export function DeepPlanRunControls({
  run,
  environmentId,
  disabled,
  canContinue = false,
  connected = true,
  threadId = run.threadId,
  latestTurnId,
  onResume,
  onFinalValidation,
}: {
  run: DeepPlanRun;
  environmentId: EnvironmentId;
  disabled: boolean;
  canContinue?: boolean;
  connected?: boolean;
  threadId?: ThreadId;
  latestTurnId?: TurnId | null;
  onResume: (automatic?: boolean) => Promise<void>;
  onFinalValidation: () => Promise<void>;
}) {
  const translate = useInterfaceTranslator().message;
  const [busy, setBusy] = useState(false);
  const [failure, setError] = useState<{
    readonly revision: number;
    readonly message: string;
  } | null>(null);
  const error = failure?.revision === run.revision ? failure.message : null;
  const inFlight = useRef(false);
  const attemptedContinuation = useRef<string | null>(null);
  const progress = selectDeepPlanProgress(run);
  const autoContinue = shouldAutoContinueDeepPlan(run, threadId);
  const continuationKey = JSON.stringify([threadId, latestTurnId]);
  const resumable =
    ["paused", "failed", "blocked"].includes(run.phase) ||
    (canContinue && ["collecting", "planning", "implementing", "validating"].includes(run.phase));
  const canValidate =
    progress.allStepsVerified &&
    run.approval !== null &&
    run.finalValidation.status !== "passed" &&
    run.finalValidation.status !== "inProgress";
  const perform = useCallback(
    async (operation: () => Promise<void>) => {
      if (disabled || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        await operation();
      } catch (cause) {
        setError({
          revision: run.revision,
          message: cause instanceof Error ? cause.message : translate("chat.deepPlan.resumeFailed"),
        });
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [disabled, run.revision, translate],
  );
  useEffect(() => {
    if (!connected) {
      attemptedContinuation.current = null;
      return;
    }
    if (
      !autoContinue ||
      !canContinue ||
      disabled ||
      inFlight.current ||
      attemptedContinuation.current === continuationKey
    )
      return;
    attemptedContinuation.current = continuationKey;
    void perform(() => onResume(true));
  }, [autoContinue, canContinue, connected, continuationKey, disabled, onResume, perform]);
  const actions = resumable ? (
    <Button
      variant="outline"
      disabled={disabled || busy}
      onClick={() => {
        attemptedContinuation.current = continuationKey;
        void perform(onResume);
      }}
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
  ) : null;
  const notice = (
    <>
      {run.pauseReason || (error && run.phase === "collecting") ? (
        <p className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
          {run.pauseReason ?? translate("chat.deepPlan.resumeCollection")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
  if (run.approval && run.plan && run.plan.steps.length > 0) {
    return (
      <DeepPlanChecklist
        run={run}
        environmentId={environmentId}
        threadId={threadId}
        actions={actions}
        notice={run.pauseReason || error ? notice : null}
      />
    );
  }
  if (!actions) return null;
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root variant={resumable || error ? "warning" : "default"}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          {notice}
          {actions}
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
