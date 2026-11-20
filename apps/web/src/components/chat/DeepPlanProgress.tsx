import { Link } from "@tanstack/react-router";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { selectDeepPlanSteps } from "@t3tools/client-runtime/deep-planning";
import type { DeepPlanReview, DeepPlanRun, EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, ChevronRightIcon, SquareCheckIcon, SquareIcon } from "lucide-react";
import { useId } from "react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { ChatSizeMotion } from "./ChatSizeMotion";

function DeepPlanReviewLink({
  environmentId,
  reviewThreadId,
}: {
  environmentId: EnvironmentId;
  reviewThreadId: ThreadId;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <Button
      variant="outline"
      size="xs"
      render={
        <Link
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(environmentId, reviewThreadId))}
        />
      }
    >
      {translate("chat.deepPlan.openReview")}
    </Button>
  );
}

function ReviewFindings({ review }: { review: DeepPlanReview }) {
  const translate = useInterfaceTranslator().message;
  const findings = new Map(review.findings.map((finding) => [JSON.stringify(finding), finding]));
  return (
    <div className="space-y-1">
      {review.summary ? <p className="whitespace-pre-wrap break-words">{review.summary}</p> : null}
      {findings.size > 0 ? (
        <>
          <p className="font-medium">{translate("chat.deepPlan.findings")}</p>
          <ul className="space-y-2">
            {[...findings].map(([key, finding]) => (
              <li key={key} className="break-words">
                <span className="font-medium">
                  {translate(`chat.deepPlan.finding.${finding.severity}`)} · {finding.title}
                </span>
                {finding.file || finding.rule ? (
                  <span className="block text-muted-foreground">
                    {[
                      finding.file && [finding.file, finding.line].filter(Boolean).join(":"),
                      finding.rule,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
                <p className="whitespace-pre-wrap text-muted-foreground">{finding.detail}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function DeepPlanChecklist({
  run,
  environmentId,
  threadId: requestedThreadId,
  placement = "composer",
}: {
  run: DeepPlanRun;
  environmentId: EnvironmentId;
  threadId?: ThreadId;
  placement?: "composer" | "plan";
}) {
  const threadId = requestedThreadId ?? run.threadId;
  const translate = useInterfaceTranslator().message;
  const [expanded, setExpanded] = useLocalStorage(
    `t3code:deep-plan-checklist-expanded:${scopedThreadKey(scopeThreadRef(environmentId, threadId))}`,
    true,
    Schema.Boolean,
  );
  const detailsId = useId();

  const plan = run.plan;
  if (!plan) return null;
  const steps = selectDeepPlanSteps(run);
  const verified = steps.filter(({ status }) => status === "verified").length;
  const finalReview = run.finalReview.reviews.at(-1);
  const finalVerdict = run.finalReview.reviews.findLast((review) => review.verdict !== null);
  const laneNumbers = new Map(run.approval?.lanes.map(({ laneId }, index) => [laneId, index + 1]));
  return (
    <div
      className={placement === "plan" ? "min-w-0" : "min-w-0 px-2 pb-2"}
      data-deep-plan-checklist={run.id}
    >
      <ChatSizeMotion>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{translate("chat.deepPlan.checklist")}</p>
            <p className="text-xs text-muted-foreground">
              {translate("chat.deepPlan.stepProgress", {
                completed: verified,
                total: steps.length,
              })}
            </p>
          </div>
          <Button
            variant="ghost-muted"
            size="icon"
            aria-label={translate(expanded ? "chat.deepPlan.collapse" : "chat.deepPlan.expand")}
            aria-controls={detailsId}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
          </Button>
        </div>
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
              {steps.map(({ step, status, laneId, review, verdict, roundLimit }, index) => {
                const lane = laneId === null ? undefined : laneNumbers.get(laneId);
                return (
                  <li key={step.id}>
                    <details className="rounded-md border border-border/70">
                      <summary className="min-h-11 cursor-pointer px-3 py-2 text-sm focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
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
                          {[
                            translate(`chat.deepPlan.status.${status}`),
                            lane === undefined ? null : translate("chat.deepPlan.lane", { lane }),
                            review
                              ? translate("chat.deepPlan.round", {
                                  round: review.round,
                                  limit: roundLimit,
                                })
                              : null,
                            verdict?.verdict
                              ? translate(`chat.deepPlan.verdict.${verdict.verdict}`)
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </summary>
                      <div className="space-y-2 px-3 pb-3 text-xs">
                        <p className="whitespace-pre-wrap text-muted-foreground">
                          {step.description}
                        </p>
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
                            {step.acceptanceCriteria.map((criterion) => (
                              <li key={criterion.id}>
                                {criterion.description}
                                <span className="block text-muted-foreground">
                                  {criterion.checkMethod}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {verdict ? <ReviewFindings review={verdict} /> : null}
                        {review ? (
                          <DeepPlanReviewLink
                            environmentId={environmentId}
                            reviewThreadId={review.reviewThreadId}
                          />
                        ) : null}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
            <div className="mt-3 space-y-1 rounded-md border border-border bg-background/60 p-3 text-xs">
              <p className="text-sm font-medium">{translate("chat.deepPlan.finalReview")}</p>
              <p className="text-muted-foreground">{plan.finalValidation.description}</p>
              <p className="text-muted-foreground">{plan.finalValidation.checkMethod}</p>
              {finalReview ? (
                <p className="text-muted-foreground">
                  {translate("chat.deepPlan.round", {
                    round: finalReview.round,
                    limit: run.finalReview.roundLimit,
                  })}
                  {finalVerdict?.verdict
                    ? ` · ${translate(`chat.deepPlan.verdict.${finalVerdict.verdict}`)}`
                    : null}
                </p>
              ) : null}
              {finalVerdict ? <ReviewFindings review={finalVerdict} /> : null}
              {finalReview ? (
                <DeepPlanReviewLink
                  environmentId={environmentId}
                  reviewThreadId={finalReview.reviewThreadId}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </ChatSizeMotion>
    </div>
  );
}
