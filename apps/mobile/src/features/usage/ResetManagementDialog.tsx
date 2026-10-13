import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ServerProviderResetCredit,
  UsageLimitsReport,
} from "@t3tools/contracts";
import {
  accountCreditBalance,
  availableResetCredits,
  liveResetAccounts,
  redeemedResetCredits,
  resetGaugeArc,
  resetGaugePoint,
  resetRecommendation,
  RESET_GAUGE_STAGES,
  type ResetRecommendation,
} from "@t3tools/shared/resetCredits";
import { formatResetsIn, usageWindowLabel } from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Circle, Line, Path, Svg, Text as SvgText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPillMenu";
import { environmentPresentations } from "../../state/presentation";
import { ResetCredits } from "./UsageLimitsSection";

function RecommendationGauge({ recommendation }: { readonly recommendation: ResetRecommendation }) {
  const low = StyleSheet.flatten(useResolveClassNames("text-primary-text")).color;
  const warning = StyleSheet.flatten(useResolveClassNames("text-warning-foreground")).color;
  const danger = StyleSheet.flatten(useResolveClassNames("text-danger-foreground")).color;
  const muted = StyleSheet.flatten(useResolveClassNames("text-foreground-muted")).color;
  const foreground = StyleSheet.flatten(useResolveClassNames("text-foreground")).color;
  const colors = { low, moderate: warning, high: danger, unavailable: muted };
  const point = resetGaugePoint(recommendation.score ?? 0, 66);
  return (
    <View className="items-center gap-1">
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Reset recommendation"
        accessibilityValue={{
          min: 0,
          max: 100,
          ...(recommendation.score === null ? {} : { now: recommendation.score }),
          text: recommendation.label,
        }}
      >
        <Svg width={220} height={136} viewBox="0 0 220 136">
          {RESET_GAUGE_STAGES.map((stage) => (
            <Path
              key={stage.stage}
              d={resetGaugeArc(stage.from + 0.8, stage.to - 0.8)}
              fill="none"
              stroke={colors[stage.stage]}
              strokeWidth={12}
              strokeLinecap="round"
              opacity={recommendation.score === null ? 0.25 : 0.8}
            />
          ))}
          {recommendation.score !== null ? (
            <>
              <Line
                x1={110}
                y1={102}
                x2={point.x}
                y2={point.y}
                stroke={colors[recommendation.stage]}
                strokeWidth={3}
                strokeLinecap="round"
              />
              <Circle cx={110} cy={102} r={5} fill={colors[recommendation.stage]} />
            </>
          ) : null}
          <SvgText x={28} y={125} textAnchor="middle" fill={muted} fontSize={11}>
            0
          </SvgText>
          <SvgText x={192} y={125} textAnchor="middle" fill={muted} fontSize={11}>
            100
          </SvgText>
          <SvgText
            x={110}
            y={132}
            textAnchor="middle"
            fill={foreground}
            fontSize={22}
            fontWeight="600"
          >
            {recommendation.score ?? "—"}
          </SvgText>
        </Svg>
      </View>
      <Text
        className="text-center text-base font-t3-medium text-foreground"
        style={{ color: colors[recommendation.stage] }}
      >
        {recommendation.label}
      </Text>
      <Text className="text-center text-sm text-foreground-muted">{recommendation.reason}</Text>
      <Text className="mt-1 text-center text-xs text-foreground-muted">
        0 = keep your reset · 100 = strongest reason to reset
      </Text>
    </View>
  );
}

function timestamp(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function CreditRow({
  credit,
  history = false,
}: {
  readonly credit: ServerProviderResetCredit;
  readonly history?: boolean;
}) {
  return (
    <View className="gap-1 rounded-2xl bg-card p-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-sm font-t3-medium text-foreground">
          {credit.title ?? "Usage limit reset"}
        </Text>
        <Text className="text-xs text-foreground-muted">{history ? "Used" : "Available"}</Text>
      </View>
      {credit.description ? (
        <Text className="text-xs text-foreground-muted">{credit.description}</Text>
      ) : null}
      {history ? (
        <Text className="text-xs text-foreground-muted">
          {credit.redeemedAt
            ? `Used ${timestamp(credit.redeemedAt)}`
            : "Redemption date not reported"}
        </Text>
      ) : (
        <>
          {credit.grantedAt ? (
            <Text className="text-xs text-foreground-muted">
              Granted {timestamp(credit.grantedAt)}
            </Text>
          ) : null}
          <Text className="text-xs text-foreground-muted">
            {credit.expiresAt ? `Expires ${timestamp(credit.expiresAt)}` : "Expiry not reported"}
          </Text>
        </>
      )}
    </View>
  );
}

function AccountDetails({
  account,
  environmentId,
  now,
}: {
  readonly account: UsageLimitsReport["accounts"][number];
  readonly environmentId: EnvironmentId;
  readonly now: number;
}) {
  const { limits } = account;
  const available = availableResetCredits(limits, now);
  const history = redeemedResetCredits(limits);
  const input =
    account.resetCreditInput ?? (account.instanceId ? { instanceId: account.instanceId } : null);
  return (
    <View className="gap-5">
      <RecommendationGauge recommendation={resetRecommendation(limits, now)} />
      <View className="flex-row items-center justify-between gap-4">
        <View className="flex-1 gap-1">
          <Text className="text-sm font-t3-medium text-foreground">
            {account.driver === "codex" ? "ChatGPT credits" : "Account credits"}
          </Text>
          <Text className="text-xs text-foreground-muted">Balance for extra usage</Text>
        </View>
        <Text className="max-w-[55%] text-right text-lg font-t3-bold tabular-nums text-foreground">
          {accountCreditBalance(limits.accountCredits)}
        </Text>
      </View>
      <View className="h-px bg-border" />
      <View className="gap-3">
        <Text accessibilityRole="header" className="text-base font-t3-bold text-foreground">
          Available resets
        </Text>
        {input && limits.resetCredits ? (
          <ResetCredits
            environmentId={environmentId}
            input={input}
            credits={limits.resetCredits}
            now={now}
          />
        ) : (
          <Text className="text-sm text-foreground-muted">
            {limits.resetCredits
              ? `${limits.resetCredits.availableCount} resets available`
              : "Reset availability has not been reported."}
          </Text>
        )}
        {available.map((credit) => (
          <CreditRow key={credit.id} credit={credit} />
        ))}
        {limits.resetCredits?.availableCount &&
        available.length < limits.resetCredits.availableCount ? (
          <Text className="text-xs text-foreground-muted">
            The account reports {limits.resetCredits.availableCount} resets; details are available
            for {available.length}.
          </Text>
        ) : null}
      </View>
      <View className="gap-3">
        <Text accessibilityRole="header" className="text-base font-t3-bold text-foreground">
          Current usage limits
        </Text>
        {limits.windows.length ? (
          limits.windows.map((window) => (
            <View key={window.id} className="gap-1.5">
              <View className="flex-row justify-between gap-3">
                <Text className="text-sm text-foreground">{usageWindowLabel(window)}</Text>
                <Text className="text-sm tabular-nums text-foreground">
                  {Math.round(window.usedPercent)}% used
                </Text>
              </View>
              <View className="h-1.5 overflow-hidden rounded-full bg-subtle-strong">
                <View
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${window.usedPercent}%` }}
                />
              </View>
              <Text className="text-xs text-foreground-muted">
                {formatResetsIn(window, now) ?? "Reset time not reported"}
              </Text>
            </View>
          ))
        ) : (
          <Text className="text-sm text-foreground-muted">
            Current usage limits have not been reported.
          </Text>
        )}
      </View>
      <View className="gap-3">
        <Text accessibilityRole="header" className="text-base font-t3-bold text-foreground">
          Reset usage history
        </Text>
        {history.length ? (
          history.map((credit) => <CreditRow key={credit.id} credit={credit} history />)
        ) : (
          <Text className="text-sm text-foreground-muted">
            No past redemptions were included in the latest account data.
          </Text>
        )}
        <Text className="text-xs text-foreground-muted">
          Shows the reset records reported by your provider. This history may be incomplete.
        </Text>
      </View>
      <Text className="text-xs text-foreground-muted">
        Account data checked {timestamp(limits.checkedAt)}. The gauge is a recommendation based on
        quota usage and reset times.
      </Text>
    </View>
  );
}

export function ResetManagementDialog({
  report,
  environmentId,
  onClose,
}: {
  readonly report: UsageLimitsReport;
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const [selectedId, setSelectedId] = useState(report.accounts[0]?.id);
  const [openedAt] = useState(Date.now);
  const accounts = liveResetAccounts(
    report,
    presentations.get(environmentId)?.serverConfig,
    openedAt,
  );
  const initial = report.accounts[0];
  const account =
    accounts.find((entry) => entry.id === selectedId) ??
    (selectedId === initial?.id && initial?.email
      ? accounts.find((entry) => entry.email === initial.email)
      : undefined) ??
    accounts[0];
  return (
    <Modal
      visible
      presentationStyle="pageSheet"
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={onClose}
    >
      <View className="flex-1 bg-sheet" accessibilityViewIsModal>
        <View className="flex-row items-center justify-between gap-3 border-b border-border p-5">
          <Text accessibilityRole="header" className="flex-1 text-lg font-t3-bold text-foreground">
            Manage resets
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close reset management"
            hitSlop={12}
            onPress={onClose}
            className="size-11 items-center justify-center"
          >
            <SymbolView name="xmark" size={18} tintColorClassName="accent-icon" />
          </Pressable>
        </View>
        <ScrollView
          contentContainerClassName="gap-5 p-5"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {accounts.length > 1 ? (
            <View className="flex-row flex-wrap gap-2">
              {accounts.map((entry, index) => (
                <Pressable
                  key={entry.id}
                  onPress={() => setSelectedId(entry.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: account?.id === entry.id }}
                  className={
                    entry.id === account?.id
                      ? "min-h-[44px] justify-center rounded-full bg-primary/15 px-3 py-2"
                      : "min-h-[44px] justify-center rounded-full bg-subtle-strong px-3 py-2"
                  }
                >
                  <Text className="text-sm font-t3-medium text-foreground">
                    {entry.displayName ?? entry.driver} · {index + 1}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {account ? (
            <>
              <Text className="text-xs text-foreground-muted">
                {account.displayName ?? account.driver}
                {account.plan ? ` · ${account.plan}` : ""}
              </Text>
              <AccountDetails
                key={`${account.id}:${account.email ?? account.limits.credentialFingerprint ?? ""}`}
                account={account}
                environmentId={environmentId}
                now={Math.max(openedAt, Date.parse(account.limits.checkedAt))}
              />
            </>
          ) : (
            <Text className="text-sm text-foreground-muted">
              No account usage data is available.
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function UsageResetMenu({
  report,
  environmentId,
}: {
  readonly report: UsageLimitsReport;
  readonly environmentId: EnvironmentId;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ControlPillMenu
        actions={[
          {
            id: "manage-resets",
            title: "Manage resets",
            image: Platform.OS === "ios" ? "ticket" : "ic_menu_manage",
          },
        ]}
        onPressAction={({ nativeEvent }) => {
          if (nativeEvent.event === "manage-resets") setOpen(true);
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Usage limit options"
          hitSlop={12}
          className="p-1 active:opacity-60"
        >
          <SymbolView name="ellipsis" size={16} tintColorClassName="accent-icon-muted" />
        </Pressable>
      </ControlPillMenu>
      {open ? (
        <ResetManagementDialog
          report={report}
          environmentId={environmentId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
