import { Link } from "@tanstack/react-router";
import {
  getDeepPlanComposerChecklistExpiresAt,
  isDeepPlanLegacyRun,
  selectDeepPlanRunControls,
  selectDeepPlanStatus,
  type DeepPlanRunAction,
} from "@t3tools/client-runtime/deep-planning";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CommandId, type ScopedThreadRef, type StoredDeepPlanRun } from "@t3tools/contracts";
import { ListChecksIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { requestConfirmDialog } from "../../confirmDialog";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { randomUUID } from "../../lib/utils";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { ThreadShell } from "../../types";
import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";
import { DeepPlanChecklist } from "./DeepPlanProgress";

export function DeepPlanRunControls({
  run,
  threadRef,
  threadShells,
  disabled,
  supported,
}: {
  run: StoredDeepPlanRun;
  threadRef: ScopedThreadRef;
  threadShells: readonly ThreadShell[];
  disabled: boolean;
  supported: boolean;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const dispatch = useOrchestrationCommand(orchestrationEnvironment.v2.dispatchCommand, {
    reportFailure: false,
  });
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ revision: number; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = getDeepPlanComposerChecklistExpiresAt(run);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Hide finished runs at their persisted deadline.
  useEffect(() => {
    if (expiresAt === null || expiresAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, now]);

  const active = !isDeepPlanLegacyRun(run) ? run : null;
  const { toggle, cancel } = selectDeepPlanRunControls(run);
  const status = selectDeepPlanStatus(run, threadShells, translator);
  const error = active && failure?.revision === active.revision ? failure.message : null;
  const implementationThreadId = active?.approval?.lanes[0]?.threadId;
  const implementationLink =
    active?.threadId === threadRef.threadId &&
    implementationThreadId &&
    implementationThreadId !== threadRef.threadId
      ? scopeThreadRef(threadRef.environmentId, implementationThreadId)
      : null;

  async function perform(action: DeepPlanRunAction) {
    if (!active || disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    if (
      action !== "cancel" ||
      (await requestConfirmDialog(translate("chat.deepPlan.cancelConfirm"), {
        variant: "destructive",
      }))
    ) {
      const result = await dispatch({
        environmentId: threadRef.environmentId,
        input: {
          type: "thread.deep-plan.update",
          commandId: CommandId.make(randomUUID()),
          threadId: active.threadId,
          runId: active.id,
          expectedRevision: active.revision,
          operationId: randomUUID(),
          createdAt: new Date().toISOString(),
          mutation: { type: action },
        },
      });
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setFailure({
          revision: active.revision,
          message:
            cause instanceof Error ? cause.message : translate("chat.deepPlan.controlFailed"),
        });
      }
    }
    inFlight.current = false;
    setBusy(false);
  }

  if (expiresAt !== null && expiresAt <= now) return null;
  // Suggest a fresh Deep Plan only for an unfinished legacy run where a new one can start.
  if (isDeepPlanLegacyRun(run) && (run.finished === true || !supported)) return null;
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root>
        <ComposerBanner.Row layout="wrap-actions">
          <ComposerBanner.Icon>
            <ListChecksIcon />
          </ComposerBanner.Icon>
          <ComposerBanner.Content
            role="status"
            className={status.tone === "warning" ? "text-warning-foreground" : undefined}
          >
            {status.label}
          </ComposerBanner.Content>
          {implementationLink || toggle || cancel ? (
            <ComposerBanner.Actions>
              {implementationLink ? (
                <Button
                  variant="ghost-muted"
                  size="xs"
                  render={
                    <Link
                      to="/$environmentId/$threadId"
                      params={buildThreadRouteParams(implementationLink)}
                    />
                  }
                >
                  {translate("chat.deepPlan.openImplementation")}
                </Button>
              ) : null}
              {toggle ? (
                <Button
                  variant="ghost-muted"
                  size="xs"
                  disabled={disabled || busy}
                  onClick={() => void perform(toggle)}
                >
                  {translate(`chat.deepPlan.${toggle}`)}
                </Button>
              ) : null}
              {cancel ? (
                <Button
                  variant="ghost-muted"
                  size="xs"
                  disabled={disabled || busy}
                  onClick={() => void perform("cancel")}
                >
                  {translate("chat.deepPlan.cancel")}
                </Button>
              ) : null}
            </ComposerBanner.Actions>
          ) : null}
        </ComposerBanner.Row>
        {error ? (
          <ComposerBanner.Body>
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          </ComposerBanner.Body>
        ) : null}
        {active?.approval ? (
          <DeepPlanChecklist
            run={active}
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
          />
        ) : null}
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
