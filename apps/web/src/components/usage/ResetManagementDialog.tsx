import type {
  EnvironmentId,
  ServerProviderResetCredit,
  UsageLimitsReport,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
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
import { MoreHorizontalIcon, TicketIcon } from "lucide-react";
import { useState } from "react";
import { environmentPresentations } from "../../state/presentation";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Separator } from "../ui/separator";
import { ResetCreditDialog, useResetCredit } from "./UsageLimits";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";

const STAGE_COLOR = {
  low: "var(--success)",
  moderate: "var(--warning)",
  high: "var(--destructive)",
  unavailable: "var(--muted-foreground)",
};

function RecommendationGauge({ recommendation }: { readonly recommendation: ResetRecommendation }) {
  const point = resetGaugePoint(recommendation.score ?? 0, 66);
  const color = STAGE_COLOR[recommendation.stage];
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <svg
        viewBox="0 0 220 136"
        className="w-56 max-w-full"
        role="meter"
        aria-label="Reset recommendation"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={recommendation.score ?? undefined}
        aria-valuetext={
          recommendation.score === null
            ? recommendation.reason
            : `${recommendation.score} out of 100. ${recommendation.label}.`
        }
      >
        <title>Reset recommendation</title>
        {RESET_GAUGE_STAGES.map((stage) => (
          <path
            key={stage.stage}
            d={resetGaugeArc(stage.from + 0.8, stage.to - 0.8)}
            fill="none"
            stroke={STAGE_COLOR[stage.stage]}
            strokeWidth={12}
            strokeLinecap="round"
            opacity={recommendation.score === null ? 0.25 : 0.8}
          />
        ))}
        {recommendation.score !== null ? (
          <>
            <line
              x1={110}
              y1={102}
              x2={point.x}
              y2={point.y}
              stroke={color}
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle cx={110} cy={102} r={5} fill={color} />
          </>
        ) : null}
        <text x={28} y={125} textAnchor="middle" fill="var(--muted-foreground)" fontSize={11}>
          0
        </text>
        <text x={192} y={125} textAnchor="middle" fill="var(--muted-foreground)" fontSize={11}>
          100
        </text>
        <text
          x={110}
          y={132}
          textAnchor="middle"
          fill="var(--foreground)"
          fontSize={22}
          fontWeight={600}
        >
          {recommendation.score ?? "—"}
        </text>
      </svg>
      <p className="text-sm font-medium" style={{ color }}>
        {recommendation.label}
      </p>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
        {recommendation.reason}
      </p>
      <p className="mt-1 text-2xs text-muted-foreground">
        0 = keep your reset · 100 = strongest reason to reset
      </p>
    </div>
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
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <TicketIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{credit.title ?? "Usage limit reset"}</p>
        {credit.description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{credit.description}</p>
        ) : null}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {history ? (
            <span>
              {credit.redeemedAt
                ? `Used ${timestamp(credit.redeemedAt)}`
                : "Redemption date not reported"}
            </span>
          ) : (
            <>
              {credit.grantedAt ? <span>Granted {timestamp(credit.grantedAt)}</span> : null}
              <span>
                {credit.expiresAt
                  ? `Expires ${timestamp(credit.expiresAt)}`
                  : "Expiry not reported"}
              </span>
            </>
          )}
        </div>
      </div>
      <span className="shrink-0 text-2xs text-muted-foreground">
        {history ? "Used" : "Available"}
      </span>
    </li>
  );
}

function ResetAction({
  account,
  environmentId,
}: {
  readonly account: UsageLimitsReport["accounts"][number];
  readonly environmentId: EnvironmentId;
}) {
  const input =
    account.resetCreditInput ?? (account.instanceId ? { instanceId: account.instanceId } : null);
  return input ? (
    <RedeemAction
      environmentId={environmentId}
      input={input}
      disabled={!account.limits.resetCredits?.availableCount}
    />
  ) : null;
}

function RedeemAction({
  environmentId,
  input,
  disabled,
}: {
  readonly environmentId: EnvironmentId;
  readonly input: NonNullable<UsageLimitsReport["accounts"][number]["resetCreditInput"]>;
  readonly disabled: boolean;
}) {
  const redeem = useResetCredit(environmentId, input);
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || redeem.busy}
        onClick={() => redeem.setConfirming(true)}
      >
        {redeem.busy ? "Using…" : "Use reset"}
      </Button>
      {redeem.status ? (
        <p role="status" className="max-w-xs text-xs text-muted-foreground">
          {redeem.status}
        </p>
      ) : null}
      <ResetCreditDialog
        open={redeem.confirming}
        onOpenChange={redeem.setConfirming}
        onConfirm={() => void redeem.redeem()}
      />
    </div>
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
  const count = limits.resetCredits?.availableCount;
  return (
    <div className="space-y-5">
      <RecommendationGauge recommendation={resetRecommendation(limits, now)} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">
            {account.driver === "codex" ? "ChatGPT credits" : "Account credits"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Balance for extra usage</p>
        </div>
        <p className="text-right text-lg font-semibold tabular-nums">
          {accountCreditBalance(limits.accountCredits)}
        </p>
      </div>
      <Separator />
      <section aria-labelledby={`available-resets-${account.id}`} className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id={`available-resets-${account.id}`} className="text-sm font-semibold">
            Available resets{count !== undefined ? ` · ${count}` : ""}
          </h3>
          <ResetAction account={account} environmentId={environmentId} />
        </div>
        {available.length ? (
          <ul className="divide-y divide-border/60">
            {available.map((credit) => (
              <CreditRow key={credit.id} credit={credit} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            {count === 0
              ? "No reset credits are currently available."
              : "Individual reset details have not been reported."}
            {limits.resetCredits?.nextExpiresAt
              ? ` Next expiry: ${timestamp(limits.resetCredits.nextExpiresAt)}.`
              : ""}
          </p>
        )}
        {count !== undefined && available.length > 0 && available.length < count ? (
          <p className="text-xs text-muted-foreground">
            The account reports {count} resets; details are available for {available.length}.
          </p>
        ) : null}
      </section>
      <section aria-labelledby={`current-usage-${account.id}`} className="space-y-3">
        <h3 id={`current-usage-${account.id}`} className="text-sm font-semibold">
          Current usage limits
        </h3>
        {limits.windows.length ? (
          <ul className="space-y-3">
            {limits.windows.map((window) => (
              <li key={window.id} className="space-y-1.5">
                <div className="flex justify-between gap-3 text-xs">
                  <span>{usageWindowLabel(window)}</span>
                  <span className="tabular-nums">{Math.round(window.usedPercent)}% used</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${window.usedPercent}%` }}
                  />
                </div>
                <p className="text-2xs text-muted-foreground">
                  {formatResetsIn(window, now) ?? "Reset time not reported"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Current usage limits have not been reported.
          </p>
        )}
      </section>
      <section aria-labelledby={`reset-history-${account.id}`} className="space-y-3">
        <h3 id={`reset-history-${account.id}`} className="text-sm font-semibold">
          Reset usage history
        </h3>
        {history.length ? (
          <ul className="divide-y divide-border/60">
            {history.map((credit) => (
              <CreditRow key={credit.id} credit={credit} history />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            No past redemptions were included in the latest account data.
          </p>
        )}
        <p className="text-2xs text-muted-foreground">
          Shows the reset records reported by your provider. This history may be incomplete.
        </p>
      </section>
      <p className="text-2xs text-muted-foreground">
        Account data checked {timestamp(limits.checkedAt)}. The gauge is a recommendation based on
        quota usage and reset times.
      </p>
    </div>
  );
}

export function ResetManagementDialog({
  report,
  environmentId,
  open,
  onOpenChange,
}: {
  readonly report: UsageLimitsReport;
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Manage resets</DialogTitle>
          <DialogDescription>Review your credits and usage before using a reset.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {accounts.length > 1 ? (
            <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Account">
              {accounts.map((entry) => (
                <Button
                  key={entry.id}
                  size="sm"
                  variant={entry.id === account?.id ? "secondary" : "outline"}
                  onClick={() => setSelectedId(entry.id)}
                >
                  {entry.displayName ?? entry.driver}
                  {accounts.filter((other) => other.driver === entry.driver).length > 1
                    ? ` · ${accounts.indexOf(entry) + 1}`
                    : ""}
                </Button>
              ))}
            </div>
          ) : null}
          {account ? (
            <>
              <div className="mb-4 text-xs text-muted-foreground">
                {account.label.includes("@") ? (
                  <RedactedSensitiveText
                    value={account.label}
                    ariaLabel="Toggle account visibility"
                    revealTooltip="Reveal account"
                    hideTooltip="Hide account"
                  />
                ) : (
                  account.label
                )}
                {account.plan ? ` · ${account.plan}` : ""}
              </div>
              <AccountDetails
                key={`${account.id}:${account.email ?? account.limits.credentialFingerprint ?? ""}`}
                account={account}
                environmentId={environmentId}
                now={Math.max(openedAt, Date.parse(account.limits.checkedAt))}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No account usage data is available.</p>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
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
      <Menu>
        <MenuTrigger
          render={<Button size="icon-xs" variant="ghost" aria-label="Usage limit options" />}
        >
          <MoreHorizontalIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => setOpen(true)}>
            <TicketIcon />
            Manage resets
          </MenuItem>
        </MenuPopup>
      </Menu>
      {open ? (
        <ResetManagementDialog
          report={report}
          environmentId={environmentId}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}
