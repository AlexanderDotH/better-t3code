import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { ArrowDownToLineIcon, ArrowUpFromLineIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { type ThreadSyncPhase } from "../../threadSync";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { formatContextWindowTokens, type ContextWindowSnapshot } from "../../lib/contextWindow";
import { ComposerBanner, type ComposerBannerVariant } from "./ComposerBanner";

export type ComposerActivityStatus =
  | {
      readonly kind: "working";
      readonly startedAt: string | null;
      readonly inputTokens?: number;
      readonly outputTokens?: number;
    }
  | { readonly kind: "sync"; readonly phase: ThreadSyncPhase };

type ComposerActivityTokenSnapshot = Pick<
  ContextWindowSnapshot,
  "updatedAt" | "inputTokens" | "lastInputTokens" | "outputTokens" | "lastOutputTokens"
>;

export interface ComposerActivityTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

const SYNC_MESSAGE_IDS = {
  loading: "chat.composer.sync.loadingMessages",
  syncing: "chat.composer.sync.syncingMessages",
} as const satisfies Record<ThreadSyncPhase, InterfaceMessageKey>;

export function composerActivityMessageId(status: ComposerActivityStatus): InterfaceMessageKey {
  if (status.kind === "sync") return SYNC_MESSAGE_IDS[status.phase];
  return status.startedAt ? "chat.timeline.workingFor" : "chat.timeline.working";
}

export function composerActivityVariant(status: ComposerActivityStatus): ComposerBannerVariant {
  return status.kind === "sync" ? "info" : "activity";
}

export function resolveComposerActivityTokenUsage(input: {
  readonly activeWorkStartedAt: string | null;
  readonly snapshot: ComposerActivityTokenSnapshot | null;
}): ComposerActivityTokenUsage {
  const startedAt = input.activeWorkStartedAt ? Date.parse(input.activeWorkStartedAt) : Number.NaN;
  const updatedAt = input.snapshot ? Date.parse(input.snapshot.updatedAt) : Number.NaN;
  if (!input.snapshot || !Number.isFinite(startedAt) || !Number.isFinite(updatedAt)) {
    return { inputTokens: 0, outputTokens: 0 };
  }
  if (updatedAt < startedAt) return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: input.snapshot.lastInputTokens ?? input.snapshot.inputTokens ?? 0,
    outputTokens: input.snapshot.lastOutputTokens ?? input.snapshot.outputTokens ?? 0,
  };
}

export function ComposerActivityIcon({ status }: { readonly status: ComposerActivityStatus }) {
  if (status.kind === "working") {
    return (
      <ComposerBanner.Icon>
        <span className="size-1.5 rounded-full bg-primary" />
      </ComposerBanner.Icon>
    );
  }
  return (
    <ComposerBanner.Icon>
      <LoaderCircleIcon className="motion-safe:animate-spin" />
    </ComposerBanner.Icon>
  );
}

export function ComposerActivityRow({ status }: { readonly status: ComposerActivityStatus }) {
  const showTokenUsage =
    status.kind === "working" &&
    (status.inputTokens !== undefined || status.outputTokens !== undefined);
  return (
    <ComposerBanner.Row>
      <ComposerActivityIcon status={status} />
      <ComposerBanner.Content>
        <ComposerActivityLabel status={status} />
      </ComposerBanner.Content>
      {showTokenUsage ? (
        <ComposerBanner.Actions>
          <ComposerActivityTokenMetrics status={status} />
        </ComposerBanner.Actions>
      ) : null}
    </ComposerBanner.Row>
  );
}

export function ComposerActivityBanner({ status }: { readonly status: ComposerActivityStatus }) {
  return (
    <ComposerBanner.Root
      data-chat-composer-activity-strip="true"
      variant={composerActivityVariant(status)}
    >
      <ComposerActivityRow status={status} />
    </ComposerBanner.Root>
  );
}

export function ComposerActivityTokenMetrics(props: {
  readonly status: ComposerActivityStatus | undefined;
}) {
  const translate = useInterfaceTranslator().message;
  if (props.status?.kind !== "working") return null;
  if (props.status.inputTokens === undefined && props.status.outputTokens === undefined)
    return null;
  const metrics = [
    {
      direction: "input",
      label: translate("chat.timeline.inputTokens"),
      value: props.status.inputTokens ?? 0,
      Icon: ArrowDownToLineIcon,
    },
    {
      direction: "output",
      label: translate("chat.timeline.outputTokens"),
      value: props.status.outputTokens ?? 0,
      Icon: ArrowUpFromLineIcon,
    },
  ] as const;
  return metrics.map(({ direction, label, value, Icon }) => {
    const formatted = formatContextWindowTokens(value);
    return (
      <span
        aria-label={`${label}: ${formatted}`}
        className="inline-flex items-center gap-1 rounded-md bg-background/35 px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground tabular-nums"
        data-composer-token-direction={direction}
        key={direction}
      >
        <Icon aria-hidden="true" className="size-3" />
        <span className="hidden sm:inline">{label}</span>
        <span className="font-mono font-medium text-foreground/75">{formatted}</span>
      </span>
    );
  });
}

export function ComposerActivityLabel({ status }: { readonly status: ComposerActivityStatus }) {
  const translator = useInterfaceTranslator();
  const label = translator.message(composerActivityMessageId(status));
  if (status.kind === "sync") {
    return (
      <span
        className="shrink-0 whitespace-nowrap text-muted-foreground"
        data-composer-sync-status={status.phase}
        role="status"
      >
        {label}
      </span>
    );
  }
  return (
    <span
      className="shrink-0 whitespace-nowrap text-muted-foreground"
      data-composer-working-status="true"
    >
      {status.startedAt ? (
        <>
          {label} <WorkingTimer createdAt={status.startedAt} />
        </>
      ) : (
        label
      )}
    </span>
  );
}

/** Updates only the elapsed text, without committing the composer or timeline each second. */
function WorkingTimer({ createdAt }: { createdAt: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const initialText = formatWorkingTimerNow(createdAt);

  useEffect(() => {
    const updateText = () => {
      if (textRef.current) {
        textRef.current.textContent = formatWorkingTimerNow(createdAt);
      }
    };
    updateText();
    const id = setInterval(updateText, 1000);
    return () => clearInterval(id);
  }, [createdAt]);

  return (
    <span ref={textRef} className="tabular-nums">
      {initialText}
    </span>
  );
}

function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatWorkingTimerNow(startIso: string): string {
  return formatWorkingTimer(startIso, new Date().toISOString()) ?? "0s";
}
