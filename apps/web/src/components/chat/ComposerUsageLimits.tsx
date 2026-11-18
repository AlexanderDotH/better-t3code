import type { EnvironmentId, ServerProvider, UsageLimitsReport } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { compactUsageWindow, limitsNotice } from "@t3tools/shared/usageLimits";
import { GaugeIcon } from "lucide-react";

import { ensureLocalApi } from "../../localApi";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { providerClients } from "../settings/providerDriverMeta";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { CompactLimitWindow, LimitWindows } from "../usage/UsageLimits";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { UsageResetMenu } from "../usage/ResetManagementDialog";
import { ComposerBanner } from "./ComposerBanner";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

function accountLabel(account: UsageLimitsReport["accounts"][number]): string {
  if (!account.instanceId) return account.label;
  const driver = providerClients.get(account.driver)?.label ?? String(account.driver);
  const instance =
    account.displayName?.trim() ||
    (String(account.instanceId) !== String(account.driver) ? account.instanceId : "");
  return instance && instance.toLowerCase() !== driver.toLowerCase()
    ? `${driver} · ${instance}`
    : driver;
}

function AccountSummary({ account }: { readonly account: UsageLimitsReport["accounts"][number] }) {
  const label = accountLabel(account);
  return (
    <>
      {label.includes("@") ? (
        <RedactedSensitiveText
          key={label}
          value={label}
          ariaLabel="Toggle account label visibility"
          revealTooltip="Click to reveal account"
          hideTooltip="Click to hide account"
          className="max-w-full truncate align-bottom font-sans text-xs leading-normal"
        />
      ) : (
        label
      )}
      {account.plan ? ` · ${account.plan}` : null}
    </>
  );
}

export function usageLimitsBannerItem(
  id: string,
  report: UsageLimitsReport,
  environmentId: EnvironmentId,
  onDismiss: () => void,
  selectedProvider?: ServerProvider | null,
): ComposerBannerStackItem {
  const [first] = report.accounts;
  const single = report.accounts.length === 1 && first ? first : null;
  const summary = single ? (
    <span className="max-w-full min-w-0 truncate align-middle">
      <AccountSummary account={single} />
    </span>
  ) : (
    `${report.accounts.length} accounts`
  );
  return {
    id,
    variant: "info",
    icon: <GaugeIcon />,
    title: "Usage limits",
    description: summary,
    compactContent: (
      <UsageLimitsCompactSummary report={report} selectedProvider={selectedProvider} />
    ),
    dismissLabel: "Dismiss usage limits",
    onDismiss,
    actions: <UsageResetMenu report={report} environmentId={environmentId} />,
    children: <UsageLimitsBannerBody report={report} />,
  };
}

function UsageLimitsCompactSummary({
  report,
  selectedProvider,
}: {
  readonly report: UsageLimitsReport;
  readonly selectedProvider: ServerProvider | null | undefined;
}) {
  const { message } = useInterfaceTranslator();
  const account =
    report.accounts.find(
      (account) =>
        account.instanceId !== undefined && account.instanceId === selectedProvider?.instanceId,
    ) ??
    (selectedProvider?.auth.email
      ? report.accounts.find(
          (account) => account.email?.toLowerCase() === selectedProvider.auth.email?.toLowerCase(),
        )
      : undefined) ??
    report.accounts[0];
  if (!account) {
    return (
      <span className="min-w-0 truncate text-muted-foreground">
        {report.notices[0] ?? "Usage limits"}
      </span>
    );
  }
  const now = Date.parse(report.createdAt);
  const notice = limitsNotice(account.limits);
  const window = compactUsageWindow(
    { driver: account.driver, windows: account.limits.windows },
    now,
  );
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {notice || !window ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{notice}</span>
      ) : (
        <CompactLimitWindow driver={account.driver} window={window} now={now} />
      )}
      {report.accounts.length > 1 ? (
        <span
          className="shrink-0 text-muted-foreground tabular-nums"
          aria-label={message("chat.composer.usageLimits.moreAccounts", {
            count: report.accounts.length - 1,
          })}
        >
          +{report.accounts.length - 1}
        </span>
      ) : null}
    </span>
  );
}

export function modelFallbackBannerItem({
  fallbackModelName,
  defaultProviderName,
  defaultModelName,
  resetsAt,
  timestampFormat,
  onUseDefault,
  onDismiss,
}: {
  readonly fallbackModelName: string;
  readonly defaultProviderName: string;
  readonly defaultModelName: string;
  readonly resetsAt: string | null;
  readonly timestampFormat: TimestampFormat;
  readonly onUseDefault: () => void;
  readonly onDismiss: () => void;
}): ComposerBannerStackItem {
  return {
    id: "fallback-model",
    variant: "info",
    icon: <GaugeIcon />,
    title: `Using ${fallbackModelName}`,
    description: `${defaultProviderName} is out of usage${resetsAt ? ` · resets ${formatUpcomingTimestamp(resetsAt, timestampFormat)}` : ""}`,
    actions: (
      <Button size="xs" variant="ghost" onClick={onUseDefault}>
        Use {defaultModelName}
      </Button>
    ),
    dismissLabel: "Dismiss fallback model notice",
    onDismiss,
  };
}

function UsageLimitsBannerBody({ report }: { readonly report: UsageLimitsReport }) {
  const now = Date.parse(report.createdAt);
  return (
    <ComposerBanner.Scroll>
      <ComposerBanner.Body className="flex flex-col gap-2 pt-1 pb-1.5 pe-2">
        {report.accounts.map((account) => {
          const notice = limitsNotice(account.limits);
          const externalUsage = account.limits.externalUsage;
          return (
            <div key={account.id} className="flex min-w-0 flex-col gap-1">
              {report.accounts.length > 1 ? (
                <span className="truncate text-xs text-muted-foreground">
                  <AccountSummary account={account} />
                </span>
              ) : null}
              {notice ? (
                <span className="text-xs text-muted-foreground">{notice}</span>
              ) : (
                <LimitWindows
                  compact
                  driver={account.driver}
                  windows={account.limits.windows}
                  now={now}
                />
              )}
              {externalUsage ? (
                <Button
                  size="sm"
                  variant="link"
                  className="self-start"
                  onClick={() => void ensureLocalApi().shell.openExternal(externalUsage.url)}
                >
                  Manage usage
                </Button>
              ) : null}
            </div>
          );
        })}
        {report.notices.map((notice) => (
          <span key={notice} className="text-xs text-muted-foreground">
            {notice}
          </span>
        ))}
      </ComposerBanner.Body>
    </ComposerBanner.Scroll>
  );
}
