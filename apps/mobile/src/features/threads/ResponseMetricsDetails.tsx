import type { ResponseMetricsSnapshot } from "@t3tools/contracts";
import { formatResponseMetrics } from "@t3tools/client-runtime/response-metrics";
import { AppText } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ResponseMetricsDetails(props: { snapshot: ResponseMetricsSnapshot | null }) {
  const translator = useMobileInterfaceTranslator();
  const metrics = formatResponseMetrics(props.snapshot, translator);
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
