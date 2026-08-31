import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CheckIcon, CopyIcon, LoaderCircleIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { readEnvironmentApi } from "~/environmentApi";
import { writeClipboardText } from "~/lib/clipboard";
import { copyThreadTranscript } from "~/lib/copyThreadTranscript";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const COPIED_STATE_DURATION_MS = 1_500;

type CopyState = "idle" | "loading" | "copied";

export const ChatTranscriptCopyButton = memo(function ChatTranscriptCopyButton({
  environmentId,
  threadId,
  activeTurnInProgress,
  environmentUnavailable,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly activeTurnInProgress: boolean;
  readonly environmentUnavailable: boolean;
}) {
  const translate = useInterfaceTranslator().message;
  const [state, setState] = useState<CopyState>("idle");
  const requestInFlightRef = useRef(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
    if (!requestInFlightRef.current) {
      setState("idle");
    }
  }, [environmentId, threadId]);

  const handleCopy = useCallback(async () => {
    if (requestInFlightRef.current || activeTurnInProgress || environmentUnavailable) return;

    const api = readEnvironmentApi(environmentId);
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: translate("chat.transcript.exportFailed"),
          description: translate("chat.transcript.environmentDisconnected"),
          data: { threadRef: { environmentId, threadId } },
        }),
      );
      return;
    }

    requestInFlightRef.current = true;
    setState("loading");

    try {
      const transcript = await copyThreadTranscript({
        threadId,
        exportThreadTranscript: api.orchestration.exportThreadTranscript,
        writeText: writeClipboardText,
      });

      if (mountedRef.current) {
        setState("copied");
        copiedTimerRef.current = setTimeout(() => {
          copiedTimerRef.current = null;
          setState("idle");
        }, COPIED_STATE_DURATION_MS);
      }

      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: translate("chat.transcript.copied"),
          description: translate("chat.transcript.unredactedMarkdown", {
            file: transcript.fileName,
          }),
          data: { threadRef: { environmentId, threadId } },
        }),
      );
    } catch (error) {
      if (mountedRef.current) {
        setState("idle");
      }
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: translate("chat.transcript.copyFailed"),
          description:
            error instanceof Error ? error.message : translate("chat.transcript.unexpectedError"),
          data: { threadRef: { environmentId, threadId } },
        }),
      );
    } finally {
      requestInFlightRef.current = false;
    }
  }, [activeTurnInProgress, environmentId, environmentUnavailable, threadId, translate]);

  const disabled = environmentUnavailable || activeTurnInProgress || state !== "idle";
  const tooltip = environmentUnavailable
    ? translate("chat.transcript.reconnectBeforeExport")
    : activeTurnInProgress
      ? translate("chat.transcript.waitForTurn")
      : state === "loading"
        ? translate("chat.transcript.preparing")
        : state === "copied"
          ? translate("chat.transcript.completeCopied")
          : translate("chat.transcript.copyComplete");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={tooltip}
            className="shrink-0"
            disabled={disabled}
            onClick={() => void handleCopy()}
            size="icon-xs"
            type="button"
            variant="outline"
          >
            {state === "loading" ? (
              <LoaderCircleIcon className="size-3 animate-spin" />
            ) : state === "copied" ? (
              <CheckIcon className="size-3 text-success" />
            ) : (
              <CopyIcon className="size-3" />
            )}
          </Button>
        }
      />
      <TooltipPopup side="bottom">{tooltip}</TooltipPopup>
    </Tooltip>
  );
});
