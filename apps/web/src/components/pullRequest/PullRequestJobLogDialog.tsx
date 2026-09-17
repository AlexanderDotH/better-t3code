import type {
  EnvironmentId,
  PullRequestCheck,
  PullRequestRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import { useOpenLink } from "~/browser/useOpenLink";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { PullRequestCheckStatusIcon, pullRequestCheckStatusLabel } from "./pullRequestPresentation";

const LOG_REFRESH_INTERVAL_MS = 5_000;
const LOG_RETRY_INTERVAL_MS = 15_000;

export function PullRequestJobLogDialog({
  environmentId,
  reference,
  check,
  threadRef,
  onClose,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  check: PullRequestCheck;
  threadRef: ScopedThreadRef | null;
  onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    check.logId === undefined
      ? null
      : pullRequestEnvironment.checkLog({
          environmentId,
          input: { ...reference, checkId: check.logId },
        }),
  );
  const openLink = useOpenLink(threadRef);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const currentCheck = query.data?.check ?? check;
  const text = query.data?.text ?? "";
  const refresh = query.refresh;
  const complete = query.data?.complete === true;

  useEffect(() => {
    if (check.logId === undefined || query.isPending || complete) return;
    const interval = query.error === null ? LOG_REFRESH_INTERVAL_MS : LOG_RETRY_INTERVAL_MS;
    let timer: ReturnType<typeof setInterval> | undefined;
    const schedule = () => {
      clearInterval(timer);
      if (document.visibilityState === "visible") {
        timer = setInterval(refresh, interval);
      }
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [check.logId, query.isPending, query.error, complete, refresh]);

  useEffect(() => {
    if (following && text.length > 0 && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [text, following]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        className="h-[80dvh] max-w-6xl overflow-hidden overscroll-contain"
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <DialogHeader className="shrink-0 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <PullRequestCheckStatusIcon
              status={currentCheck.status}
              pendingState={currentCheck.pendingState}
            />
            <span className="truncate">{currentCheck.name}</span>
          </DialogTitle>
          <DialogDescription>
            {currentCheck.stage ? `${currentCheck.stage} · ` : ""}
            {pullRequestCheckStatusLabel(currentCheck)} · Job #{check.logId}
          </DialogDescription>
        </DialogHeader>
        {query.error !== null ? (
          <p role="alert" className="border-t px-6 py-3 text-sm text-destructive">
            {query.error}
          </p>
        ) : null}
        {query.data?.truncated ? (
          <p className="border-t px-6 py-2 text-xs text-muted-foreground">
            Showing the latest 256 KiB. Open GitLab for the full log.
          </p>
        ) : null}
        <div
          ref={scrollRef}
          className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain border-y bg-muted/30 px-6 py-4"
          onScroll={(event) => {
            const node = event.currentTarget;
            setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 32);
          }}
          tabIndex={0}
          aria-label="Job log"
        >
          {text ? (
            <pre className="font-mono text-xs leading-5">{text}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              {query.isPending
                ? "Loading job log…"
                : query.error
                  ? "The log could not be loaded."
                  : query.data?.complete
                    ? "No log output is available for this job."
                    : "Waiting for job output…"}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 py-3">
          <span className="mr-auto text-xs text-muted-foreground">
            {query.error
              ? "Retrying automatically every 15 seconds…"
              : query.isPending
                ? "Updating…"
                : query.data?.complete
                  ? "Job finished"
                  : "Live · updates every 5 seconds"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={following}
            onClick={() => setFollowing(!following)}
          >
            Follow output
          </Button>
          {currentCheck.url ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void openLink(currentCheck.url!).catch(() =>
                  toastManager.add({ type: "error", title: "Unable to open GitLab" }),
                );
              }}
            >
              Open GitLab
            </Button>
          ) : null}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
