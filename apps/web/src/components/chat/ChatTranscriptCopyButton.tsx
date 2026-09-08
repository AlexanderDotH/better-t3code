import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CheckIcon, CopyIcon, LoaderCircleIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
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
  const exportTranscript = useAtomCommand(orchestrationEnvironment.exportThreadTranscript, {
    reportFailure: false,
  });
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

  const handleCopy = useCallback(async () => {
    if (requestInFlightRef.current || activeTurnInProgress || environmentUnavailable) return;

    requestInFlightRef.current = true;
    setState("loading");

    let interrupted = false;
    try {
      const transcript = await copyThreadTranscript({
        threadId,
        exportThreadTranscript: async (input) => {
          const result = await exportTranscript({ environmentId, input });
          if (result._tag === "Failure") {
            interrupted = isAtomCommandInterrupted(result);
            throw squashAtomCommandFailure(result);
          }
          return result.value;
        },
        writeText: async (content) => {
          await writeTextToClipboard(content, "thread transcript");
        },
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
      if (interrupted) return;
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
  }, [
    activeTurnInProgress,
    environmentId,
    environmentUnavailable,
    exportTranscript,
    threadId,
    translate,
  ]);

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
