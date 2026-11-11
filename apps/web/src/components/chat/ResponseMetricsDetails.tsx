import type { MessageId } from "@t3tools/contracts";
import type { ResponseMetrics } from "@t3tools/client-runtime/response-metrics";
import { formatResponseMetrics } from "@t3tools/client-runtime/response-metrics";
import { useId } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useNowSecond } from "../../hooks/useNowSecond";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function ResponseMetricsDetails(props: {
  snapshot: ResponseMetrics | null;
  message?: { readonly id: MessageId; readonly text: string };
}) {
  const id = useId();
  const translator = useInterfaceTranslator();
  const nowMs = useNowSecond(props.snapshot?.liveStartedAt !== undefined);
  const metrics = formatResponseMetrics(props.snapshot, translator, {
    nowMs,
    ...(props.message === undefined ? {} : { message: props.message }),
  });
  if (metrics === null) return null;

  return (
    <>
      {Object.entries(metrics).map(([key, metric]) => (
        <span key={key} className="inline-flex shrink-0 items-center gap-2">
          {key !== "speed" ? (
            <span aria-hidden className="text-xs text-muted-foreground">
              ·
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              aria-describedby={`${id}-${key}`}
              render={
                <span
                  tabIndex={0}
                  className="whitespace-nowrap text-muted-foreground text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-ring"
                />
              }
            >
              {metric.text}
            </TooltipTrigger>
            <TooltipPopup id={`${id}-${key}`} role="tooltip">
              {metric.tooltip}
            </TooltipPopup>
          </Tooltip>
        </span>
      ))}
    </>
  );
}
