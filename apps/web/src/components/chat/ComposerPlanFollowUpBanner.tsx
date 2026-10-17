import { memo } from "react";
import { formatPlanExecutionDuration } from "@t3tools/client-runtime/plan-implementation";
import { CheckIcon, Clock3Icon } from "lucide-react";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { ComposerBanner } from "./ComposerBanner";
import type { estimatePlanExecution } from "./planExecutionEstimate";

export const ComposerPlanFollowUpBanner = memo(function ComposerPlanFollowUpBanner({
  planTitle,
  estimate,
  deepPlan = false,
}: {
  planTitle: string | null;
  deepPlan?: boolean;
  estimate?: ReturnType<typeof estimatePlanExecution> | undefined;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const accent = deepPlan ? "text-deep-plan" : "text-primary";
  return (
    <div className="py-1">
      <ComposerBanner.Row>
        <ComposerBanner.Icon className={accent}>
          <CheckIcon />
        </ComposerBanner.Icon>
        <ComposerBanner.Content className="flex-wrap gap-x-2">
          <span
            className={
              deepPlan
                ? "shrink-0 font-medium text-deep-plan"
                : "shrink-0 font-medium text-muted-foreground"
            }
          >
            {translate(deepPlan ? "chat.deepPlan.ready" : "chat.composer.planReady")}
          </span>
          {planTitle ? (
            <span className="min-w-0 flex-1 truncate text-foreground/85">{planTitle}</span>
          ) : null}
        </ComposerBanner.Content>
      </ComposerBanner.Row>
      {estimate ? (
        <ComposerBanner.Body className="pt-1 pr-3 pb-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <Clock3Icon aria-hidden className={`size-3.5 ${accent}`} />
              {formatPlanExecutionDuration(estimate, translator)}
            </span>
            <span className="text-muted-foreground">
              {translate("chat.planEstimate.scope", { count: estimate.workUnits })}
            </span>
          </div>
        </ComposerBanner.Body>
      ) : null}
    </div>
  );
});
