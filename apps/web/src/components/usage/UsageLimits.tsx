import {
  type EnvironmentId,
  type ProviderConsumeResetCreditOutcome,
  ProviderConsumeResetCreditInput,
  ServerProvider,
  ServerProviderResetCredits,
  ServerProviderUsageWindow,
  UsageProviderKind,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  displayLimitWindows,
  formatDuration,
  formatResetCountdown,
  formatUsageResetAt,
  remainingPercent,
  usageWindowLabel,
} from "@t3tools/shared/usageLimits";
import { type ReactNode, useState } from "react";

import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { UsageLimitsPooled } from "./UsageLimitsPooled";
import { PROVIDER_PRESENTATION } from "./usageProviders";
import { UsagePaceBar, UsagePaceTooltip, UsageWindowDetails } from "./UsagePaceDetails";

/** The series colour the cost chart uses for this driver, so the two views read as one. */
export function barColor(driver: ServerProvider["driver"]): string {
  const kind: UsageProviderKind | undefined =
    driver === "codex" ? "codex" : driver === "claudeAgent" ? "claude" : undefined;
  return kind ? PROVIDER_PRESENTATION[kind].color : "var(--foreground)";
}

/**
 * Remaining quota, with the exact reset time available on hover or focus.
 */
function WindowBar({
  color,
  window,
  now,
  compact = false,
  focusable = true,
}: {
  readonly color: string;
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly compact?: boolean;
  readonly focusable?: boolean;
}) {
  const { locale } = useInterfaceLocaleRuntime();
  const remaining = remainingPercent(window);
  const resetsIn = formatResetCountdown(window, now);
  const resetsAt = formatUsageResetAt(window, locale);
  const summary = `${usageWindowLabel(window)}: ${remaining}% left${resetsIn ? `, ${resetsIn}` : ""}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="group"
            aria-label={summary}
            tabIndex={focusable ? 0 : undefined}
            className={`relative block cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${compact ? "h-4" : "h-6"}`}
          />
        }
      >
        <div className="absolute inset-x-0 inset-y-1.5 rounded-full bg-muted" />
        <div className="usage-window-track">
          {remaining > 0 ? (
            <div
              className="usage-window-fill"
              style={{ width: `${remaining}%`, backgroundColor: color }}
            />
          ) : null}
          <UsagePaceBar window={window} now={now} baseColor={color} />
        </div>
      </TooltipTrigger>
      <TooltipPopup side="top">
        <div className="flex max-w-80 flex-col gap-1.5">
          <span className="text-foreground">{remaining}% left</span>
          <UsagePaceTooltip window={window} now={now} />
          {resetsAt ? (
            <span className="text-muted-foreground">
              Resets {resetsAt}
              {resetsIn ? ` · ${resetsIn}` : ""}
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export function CompactLimitWindow({
  driver,
  window,
  now,
}: {
  readonly driver: ServerProvider["driver"];
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  return (
    <span className="@container/compact-limit flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 truncate text-muted-foreground">{usageWindowLabel(window)}</span>
      <span className="shrink-0 font-medium tabular-nums">{remainingPercent(window)}% left</span>
      <span className="hidden min-w-8 flex-1 @min-[25rem]/compact-limit:block">
        <WindowBar color={barColor(driver)} window={window} now={now} compact focusable={false} />
      </span>
      <span className="ms-auto shrink-0">
        <UsageWindowDetails window={window} now={now} focusable={false} />
      </span>
    </span>
  );
}

/**
 * One account's windows as rows: label and percent, bar, pace and countdown.
 * Compact rows fit the composer panel with narrower columns.
 */
export function LimitWindows({
  driver,
  windows,
  now,
  compact = false,
}: {
  readonly driver: ServerProvider["driver"];
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly now: number;
  readonly compact?: boolean;
}) {
  const color = barColor(driver);
  return (
    <div className="@container/limits">
      <div
        className={
          compact
            ? "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 @min-[30rem]/limits:grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto]"
            : "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 @min-[30rem]/limits:grid-cols-[11rem_minmax(3rem,1fr)_auto]"
        }
      >
        {displayLimitWindows({ driver, windows }).map((window) => (
          <div key={window.id} className="col-span-full grid grid-cols-subgrid items-center">
            <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground">{usageWindowLabel(window)}</span>
              <span className="ms-auto shrink-0 font-medium text-foreground tabular-nums">
                {remainingPercent(window)}% left
              </span>
            </span>
            <div className="col-span-full col-start-1 row-start-2 @min-[30rem]/limits:col-span-1 @min-[30rem]/limits:col-start-2 @min-[30rem]/limits:row-start-1">
              <WindowBar color={color} window={window} now={now} />
            </div>
            <span className="col-start-2 row-start-1 flex items-center justify-end text-xs @min-[30rem]/limits:col-start-3">
              <UsageWindowDetails window={window} now={now} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const OUTCOME_TEXT: Record<ProviderConsumeResetCreditOutcome, string> = {
  reset: "Reset applied. Your windows have cleared.",
  nothingToReset: "Nothing to reset right now.",
  noCredit: "No reset credit left.",
  alreadyRedeemed: "That credit was already redeemed.",
};

/** Everything a redeem needs: where to send it and what to say afterwards. */
export function useResetCredit(
  environmentId: EnvironmentId,
  input: ProviderConsumeResetCreditInput,
) {
  const consume = useAtomCommand(serverEnvironment.consumeResetCredit, { reportFailure: false });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const redeem = async () => {
    setConfirming(false);
    setBusy(true);
    setStatus(null);
    const result = await consume({ environmentId, input });
    setBusy(false);
    if (result._tag === "Success") {
      setStatus(result.value.warning ?? OUTCOME_TEXT[result.value.outcome]);
      return;
    }
    setStatus(
      "error" in result.cause && result.cause.error instanceof Error
        ? result.cause.error.message
        : "Could not use the reset credit.",
    );
  };

  return { confirming, setConfirming, busy, status, redeem };
}

/**
 * The confirm for a redeem. Redeeming spends a credit the provider granted the
 * user, so it never fires on a bare click. Mount it outside any popover that
 * holds the button: dialogs stack under popovers, and closing the popover
 * would unmount a dialog rendered inside it.
 */
export function ResetCreditDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Use a reset credit?</AlertDialogTitle>
          <AlertDialogDescription>
            This redeems one credit on your account and clears the current rate-limit windows. It
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button onClick={onConfirm}>Use credit</Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/** `2 reset credits banked · next expires in 27d 23h`, or the short form for a popover. */
export function resetCreditsSummary(
  credits: ServerProviderResetCredits,
  now: number,
  compact = false,
): string {
  const expiresIn = credits.nextExpiresAt
    ? formatDuration(Date.parse(credits.nextExpiresAt) - now)
    : null;
  if (credits.availableCount === 0) return "No reset credits banked";
  if (compact)
    return `${credits.availableCount} banked${expiresIn ? ` · expires in ${expiresIn}` : ""}`;
  return `${credits.availableCount} ${credits.availableCount === 1 ? "reset credit" : "reset credits"} banked${
    expiresIn ? ` · next expires in ${expiresIn}` : ""
  }`;
}

/**
 * Subscription quota across every connected environment's providers and hubs,
 * pooled per provider. The page advances `now` on explicit refresh rather than
 * ticking: a live clock would repaint the page for no decision-changing gain.
 */
export function UsageLimitsSection({
  selectedEnvironmentIds,
  hiddenProviders,
  now,
  cursorPrompt,
}: {
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly now: number;
  readonly cursorPrompt?: ReactNode;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const hiddenDrivers = new Set<ServerProvider["driver"]>(
    [...hiddenProviders].map((provider) => PROVIDER_PRESENTATION[provider].driverKind),
  );
  const isVisible = (driver: ServerProvider["driver"]) => !hiddenDrivers.has(driver);
  const selected = new Map(
    [...presentations].flatMap(([id, presentation]) => {
      if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(id)) return [];
      const config = presentation.serverConfig;
      if (hiddenDrivers.size === 0 || config === null) return [[id, presentation] as const];
      return [
        [
          id,
          {
            ...presentation,
            serverConfig: {
              ...config,
              providers: config.providers.filter((provider) => isVisible(provider.driver)),
              usageLimitSources: config.usageLimitSources?.flatMap((source) => {
                const accounts = source.accounts.filter((account) => isVisible(account.driver));
                return accounts.length === 0 && source.accounts.length > 0
                  ? []
                  : [{ ...source, accounts }];
              }),
            },
          },
        ] as const,
      ];
    }),
  );
  return <UsageLimitsPooled presentations={selected} now={now} cursorPrompt={cursorPrompt} />;
}
