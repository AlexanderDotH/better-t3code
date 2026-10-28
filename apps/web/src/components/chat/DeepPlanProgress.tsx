import { useEffect, useId, useState, type ReactNode } from "react";
import type { DeepPlanRun, DeepPlanStepStatus, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import * as Schema from "effect/Schema";
import {
  deepPlanCitationTitles,
  deepPlanSourceTitle,
  selectDeepPlanSourceAnalysis,
  getDeepPlanComposerChecklistExpiresAt,
  selectDeepPlanProgress,
  selectDeepPlanSteps,
} from "@t3tools/client-runtime/deep-planning";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  ListChecksIcon,
  SquareIcon,
  SquareCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";
import { ChatSizeMotion } from "./ChatSizeMotion";

function stepStatusMessage(status: DeepPlanStepStatus) {
  switch (status) {
    case "pending":
      return "chat.deepPlan.status.open";
    case "inProgress":
      return "chat.deepPlan.status.inProgress";
    case "implemented":
      return "chat.deepPlan.status.implemented";
    case "verified":
      return "chat.deepPlan.status.verified";
    case "failed":
      return "chat.deepPlan.status.failed";
    case "blocked":
      return "chat.deepPlan.status.blocked";
  }
}

export function DeepPlanAnalysisProgress({ run }: { run: DeepPlanRun }) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const completed = selectDeepPlanProgress(run).summarizedSourceCount;
  const collecting = run.phase === "collecting";
  const missing = run.sourceCoverage.filter(
    (source) => source.status === "unavailable" || source.status === "failed",
  );
  const analysis = selectDeepPlanSourceAnalysis(run, translator);
  if (
    run.phase !== "collecting" &&
    run.phase !== "planning" &&
    missing.length === 0 &&
    completed === run.sources.length
  )
    return null;
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root variant={missing.length > 0 ? "warning" : "default"}>
        <div className="space-y-2 p-3" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <strong className="font-medium">{translate("chat.deepPlan.analysisTitle")}</strong>
            <span className="text-muted-foreground">
              {collecting
                ? translate("chat.deepPlan.collecting")
                : translate("chat.deepPlan.analysisProgress", {
                    completed,
                    total: run.sources.length,
                  })}
            </span>
          </div>
          {collecting ? (
            <p className="text-xs text-muted-foreground">
              {translate("chat.deepPlan.collectingHint")}
            </p>
          ) : (
            <progress
              className="h-1.5 w-full accent-primary"
              value={completed}
              max={Math.max(1, run.sources.length)}
              aria-label={translate("chat.deepPlan.analysisTitle")}
            />
          )}
          <ul className="max-h-36 overflow-y-auto overscroll-contain text-xs">
            {analysis.map(({ source, failed, label }) => (
              <li
                key={source.sourceId}
                className="flex min-w-0 items-start justify-between gap-3 py-1"
              >
                <span className="min-w-0 break-words">
                  {deepPlanSourceTitle(source)}
                  {source.archived ? (
                    <span className="block text-muted-foreground">
                      {translate("chat.deepPlan.archived")}
                    </span>
                  ) : null}
                </span>
                <span
                  className={failed ? "text-warning-foreground" : "shrink-0 text-muted-foreground"}
                >
                  {label}
                </span>
              </li>
            ))}
          </ul>
          {missing.length > 0 ? (
            <p role="status" className="text-xs text-warning-foreground">
              {translate("chat.deepPlan.missingSources", { count: missing.length })}.{" "}
              {translate("chat.deepPlan.missingSourceHint")}
            </p>
          ) : null}
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}

export function DeepPlanChecklist({
  run,
  environmentId,
  threadId = run.threadId,
  placement = "composer",
  actions,
  notice,
}: {
  run: DeepPlanRun;
  environmentId: EnvironmentId;
  threadId?: ThreadId;
  placement?: "composer" | "plan";
  actions?: ReactNode;
  notice?: ReactNode;
}) {
  const translate = useInterfaceTranslator().message;
  const [expanded, setExpanded] = useLocalStorage(
    `t3code:deep-plan-checklist-expanded:${threadKey({ environmentId, threadId })}`,
    true,
    Schema.Boolean,
  );
  const detailsId = useId();
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = placement === "composer" ? getDeepPlanComposerChecklistExpiresAt(run) : null;
  useEffect(() => {
    if (expiresAt === null || expiresAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  const expired = expiresAt !== null && expiresAt <= now;
  const plan = run.plan;
  if (!plan || plan.steps.length === 0 || expired) return null;
  const steps = selectDeepPlanSteps(run);
  const completed = selectDeepPlanProgress(run).verifiedSteps;
  const current =
    steps.find((entry) => entry.status === "inProgress")?.step ??
    steps.find((entry) => entry.status !== "verified")?.step;
  const validation = run.finalValidation;
  const content = (
    <div
      className={placement === "plan" ? "min-w-0" : "min-w-0 p-3"}
      data-deep-plan-checklist={run.id}
    >
      <ChatSizeMotion>
        <div className="flex min-w-0 items-center gap-2">
          <ListChecksIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{translate("chat.deepPlan.checklist")}</p>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {translate("chat.deepPlan.stepProgress", { completed, total: plan.steps.length })}
            </p>
          </div>
          {actions}
          <Button
            variant="ghost-muted"
            size="icon"
            aria-label={translate(expanded ? "chat.deepPlan.collapse" : "chat.deepPlan.expand")}
            aria-controls={detailsId}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <ChevronDownIcon aria-hidden="true" />
            ) : (
              <ChevronRightIcon aria-hidden="true" />
            )}
          </Button>
        </div>
        {notice ? <div className="mt-2 space-y-2">{notice}</div> : null}
        {current ? (
          <p className="mt-2 break-words text-xs text-muted-foreground">
            {translate("chat.deepPlan.currentStep", { title: current.title })}
          </p>
        ) : null}
        {expanded ? (
          <div
            id={detailsId}
            className={
              placement === "plan"
                ? "mt-2"
                : "mt-2 max-h-[min(36dvh,20rem)] overflow-y-auto overscroll-contain"
            }
          >
            <ol className="space-y-1">
              {steps.map(({ step, status, evidence }, index) => {
                const sources = deepPlanCitationTitles(
                  step.sources,
                  run.sources,
                  translate("chat.deepPlan.sourceUnavailable"),
                );
                return (
                  <li key={step.id}>
                    <details className="rounded-md border border-border/70">
                      <summary className="min-h-11 cursor-pointer px-3 py-2 text-sm focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {status === "verified" ? (
                          <SquareCheckIcon
                            aria-hidden
                            className="me-2 inline size-3.5 align-text-bottom text-success-foreground"
                          />
                        ) : (
                          <SquareIcon
                            aria-hidden
                            className="me-2 inline size-3.5 align-text-bottom text-muted-foreground"
                          />
                        )}
                        <span className="break-words">
                          {index + 1}. {step.title}
                        </span>
                        <span className="ms-2 text-xs text-muted-foreground">
                          {translate(stepStatusMessage(status))}
                        </span>
                      </summary>
                      <div className="space-y-2 px-3 pb-3 text-xs">
                        <p className="whitespace-pre-wrap text-muted-foreground">
                          {step.description}
                        </p>
                        {sources.length > 0 ? (
                          <p className="break-words text-muted-foreground">
                            {translate("chat.deepPlan.sources")}: {sources.join("; ")}
                          </p>
                        ) : null}
                        {step.dependencies.length > 0 ? (
                          <p className="break-words text-muted-foreground">
                            {translate("chat.deepPlan.dependencies")}:{" "}
                            {step.dependencies
                              .map(
                                (id) =>
                                  plan.steps.find((dependency) => dependency.id === id)?.title,
                              )
                              .filter(Boolean)
                              .join("; ")}
                          </p>
                        ) : null}
                        <div>
                          <strong className="font-medium">
                            {translate("chat.deepPlan.requirements")}
                          </strong>
                          <ul className="mt-1 list-disc space-y-1 ps-4">
                            {step.acceptanceCriteria.map((criterion) => {
                              const titles = deepPlanCitationTitles(
                                criterion.sources,
                                run.sources,
                                translate("chat.deepPlan.sourceUnavailable"),
                              );
                              return (
                                <li key={criterion.id}>
                                  {criterion.description}
                                  <span className="block text-muted-foreground">
                                    {criterion.checkMethod}
                                  </span>
                                  {titles.length > 0 ? (
                                    <span className="block break-words text-muted-foreground">
                                      {translate("chat.deepPlan.sources")}: {titles.join("; ")}
                                    </span>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                        <div>
                          <strong className="font-medium">
                            {translate("chat.deepPlan.evidence")}
                          </strong>
                          {evidence.length ? (
                            <ul className="mt-1 list-disc space-y-1 ps-4">
                              {evidence.map((item) => (
                                <li
                                  key={`${item.createdAt}:${item.kind}:${item.summary}:${item.reference ?? ""}`}
                                  className="break-words"
                                >
                                  {item.summary}
                                  {item.reference ? (
                                    <span className="block whitespace-pre-wrap text-muted-foreground">
                                      {item.reference}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1 text-muted-foreground">
                              {translate("chat.deepPlan.noEvidence")}
                            </p>
                          )}
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
            <div
              className="mt-3 rounded-md border border-border bg-background/60 p-3"
              data-deep-plan-final-validation="true"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                {validation.status === "passed" ? (
                  <CircleCheckIcon className="size-4" aria-hidden="true" />
                ) : validation.status === "failed" ? (
                  <TriangleAlertIcon className="size-4" aria-hidden="true" />
                ) : null}
                {translate("chat.deepPlan.finalValidation")}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {plan.finalValidation.description}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {translate("chat.deepPlan.checkMethod")}: {plan.finalValidation.checkMethod}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {validation.status === "passed"
                  ? translate("chat.deepPlan.status.verified")
                  : validation.status === "failed"
                    ? translate("chat.deepPlan.status.failed")
                    : validation.status === "inProgress"
                      ? translate("chat.deepPlan.status.inProgress")
                      : translate("chat.deepPlan.validationPending")}
              </p>
              {validation.evidence.length ? (
                <ul className="mt-2 list-disc space-y-1 ps-4 text-xs">
                  {validation.evidence.map((item) => (
                    <li
                      key={`${item.createdAt}:${item.kind}:${item.summary}:${item.reference ?? ""}`}
                      className="break-words"
                    >
                      {item.summary}
                      {item.reference ? (
                        <span className="block text-muted-foreground">{item.reference}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </ChatSizeMotion>
    </div>
  );
  if (placement === "plan") return content;
  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root
        variant={run.phase === "blocked" || run.phase === "failed" ? "warning" : "default"}
      >
        {content}
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
