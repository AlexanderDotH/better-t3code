import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { type ThreadSyncPhase } from "../../threadSync";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import type { ThreadTokenUsage } from "../../lib/threadTokenUsage";
import { ComposerTokenUsageMetrics } from "./ComposerTokenUsageMetrics";
import { ComposerBanner, type ComposerBannerVariant } from "./ComposerBanner";

export type ComposerActivityStatus =
  | {
      readonly kind: "working";
      readonly startedAt: string | null;
      readonly tokenUsage?: ThreadTokenUsage | undefined;
    }
  | { readonly kind: "sync"; readonly phase: ThreadSyncPhase };

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
      <LoaderCircleIcon className="size-3" />
    </ComposerBanner.Icon>
  );
}

export function ComposerActivityRow(
  props: { readonly status: ComposerActivityStatus } | { readonly phase: ThreadSyncPhase },
) {
  const status: ComposerActivityStatus =
    "status" in props ? props.status : { kind: "sync", phase: props.phase };
  const showTokenUsage = status.kind === "working" && status.tokenUsage !== undefined;
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

export function ComposerActivityTokenMetrics(props: {
  readonly status: ComposerActivityStatus | undefined;
}) {
  return props.status?.kind === "working" && props.status.tokenUsage ? (
    <ComposerTokenUsageMetrics usage={props.status.tokenUsage} />
  ) : null;
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

export function formatWorkingTimer(startIso: string, endIso: string): string | null {
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
