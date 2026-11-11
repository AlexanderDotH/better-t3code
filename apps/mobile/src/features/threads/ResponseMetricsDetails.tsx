import type { MessageId } from "@t3tools/contracts";
import {
  formatResponseMetrics,
  type ResponseMetrics,
} from "@t3tools/client-runtime/response-metrics";
import { AppText } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useVisibleSecondClock } from "./use-visible-second-clock";

interface Props {
  readonly snapshot: ResponseMetrics | null;
  readonly message?: { readonly id: MessageId; readonly text: string };
}

export function ResponseMetricsDetails(props: Props) {
  return props.snapshot?.liveStartedAt === undefined ? (
    <ResponseMetricsLabels {...props} />
  ) : (
    <LiveResponseMetrics {...props} />
  );
}

function LiveResponseMetrics(props: Props) {
  const nowMs = useVisibleSecondClock(true);
  return <ResponseMetricsLabels {...props} nowMs={nowMs} />;
}

function ResponseMetricsLabels(props: Props & { readonly nowMs?: number }) {
  const translator = useMobileInterfaceTranslator();
  const metrics = formatResponseMetrics(props.snapshot, translator, {
    ...(props.nowMs === undefined ? {} : { nowMs: props.nowMs }),
    ...(props.message === undefined ? {} : { message: props.message }),
  });
  if (metrics === null) return null;

  return (
    <>
      {Object.entries(metrics).map(([key, metric]) => (
        <AppText
          key={key}
          accessibilityHint={metric.tooltip}
          className="shrink-0 text-xs tabular-nums text-foreground-secondary"
          numberOfLines={1}
        >
          {metric.text}
        </AppText>
      ))}
    </>
  );
}
