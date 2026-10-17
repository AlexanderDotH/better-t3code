import type { ContextWindowSnapshot } from "@t3tools/client-runtime/context-window";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

const CONTEXT_USAGE_WARNING_PERCENTAGE = 90;

export function contextMeterPresentation(
  snapshot: ContextWindowSnapshot,
  translator: InterfaceTranslator,
) {
  const usedTokens = translator.number(snapshot.usedTokens);
  const maxTokens = snapshot.maxTokens ?? null;
  const limit =
    maxTokens === null
      ? translator.message("chat.contextMeter.limitUnknown")
      : translator.number(maxTokens);
  const percentage =
    snapshot.usedPercentage === null
      ? "–"
      : translator.number(snapshot.usedPercentage / 100, {
          style: "percent",
          maximumFractionDigits: 1,
        });

  return {
    usedTokens,
    limit,
    percentage,
    fill: Math.min(100, Math.max(0, snapshot.usedPercentage ?? 0)) / 100,
    critical: (snapshot.usedPercentage ?? 0) > CONTEXT_USAGE_WARNING_PERCENTAGE,
    accessibilityLabel:
      snapshot.usedPercentage === null
        ? translator.message("chat.contextMeter.accessibleUnknown", { used: usedTokens })
        : translator.message("chat.contextMeter.accessibleKnown", {
            used: usedTokens,
            limit,
            percentage,
          }),
  };
}
