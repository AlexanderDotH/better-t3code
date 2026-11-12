import { useAtomValue } from "@effect/atom-react";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { dailyUsagePace } from "@t3tools/shared/usageLimits";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mobilePreferencesAtom } from "../../state/preferences";
import { InsightValue } from "../diagnostics/InsightsSheet";

export function UsagePaceDetails(props: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly accountLabel?: string;
}) {
  const translator = useMobileInterfaceTranslator();
  const result = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.getOrElse(result, () => null);
  const pace = dailyUsagePace(props.window, props.now, preferences?.usagePacingWorkdayHours ?? 8);
  if (preferences?.usagePacingEnabled === false || pace === null) return null;
  const percent = (value: number) => `${translator.number(value, { maximumFractionDigits: 1 })}%`;
  return (
    <View className="gap-1 py-2">
      {props.accountLabel ? (
        <AppText className="text-xs text-foreground-muted">{props.accountLabel}</AppText>
      ) : null}
      <AppText className="text-sm text-foreground">
        {translator.message(`mobile.insights.pace.${pace.status}`)}
      </AppText>
      {pace.todayUsedPercent === null ? (
        <AppText className="text-xs text-foreground-muted">
          {translator.message("mobile.insights.pace.needsHistory")}
        </AppText>
      ) : (
        <>
          <InsightValue
            label={translator.message("mobile.insights.pace.observed")}
            value={percent(pace.todayUsedPercent)}
          />
          <InsightValue
            label={translator.message("mobile.insights.pace.budget", { hours: pace.workdayHours })}
            value={percent(pace.dailyBudgetPercent)}
          />
          <InsightValue
            label={translator.message("mobile.insights.pace.hourly")}
            value={percent(pace.hourlyBudgetPercent)}
          />
          <InsightValue
            label={translator.message(
              pace.todayBalancePercent < 0
                ? "mobile.insights.pace.overdrawn"
                : "mobile.insights.pace.remaining",
            )}
            value={percent(Math.abs(pace.todayBalancePercent))}
          />
          {pace.todayBudgetUsedPercent !== null ? (
            <InsightValue
              label={translator.message("mobile.insights.pace.allowanceUsed")}
              value={percent(pace.todayBudgetUsedPercent)}
            />
          ) : null}
          {pace.catchUpRemainingPercent > 0 ? (
            <InsightValue
              label={translator.message("mobile.insights.pace.catchUp")}
              value={percent(pace.catchUpRemainingPercent)}
            />
          ) : null}
        </>
      )}
    </View>
  );
}
