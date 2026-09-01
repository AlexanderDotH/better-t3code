import { useEffect, useRef } from "react";

import { type SlowRpcAckRequest, useSlowRpcAckRequests } from "../rpc/requestLatencyState";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useInterfaceTranslator } from "../hooks/useInterfaceTranslator";
import { toastManager } from "./ui/toast";

function describeSlowRequests(
  requests: ReadonlyArray<SlowRpcAckRequest>,
  translator: InterfaceTranslator,
): string {
  const count = requests.length;
  // Thresholds vary per method, so report the smallest one the batch has passed.
  const thresholdSeconds = Math.round(
    Math.min(...requests.map((request) => request.thresholdMs)) / 1000,
  );

  return translator.message("ui.slowRequests.description", {
    count,
    formattedCount: translator.number(count),
    seconds: translator.number(thresholdSeconds),
  });
}

function SlowRequestDetails({
  requests,
  translator,
}: {
  requests: ReadonlyArray<SlowRpcAckRequest>;
  translator: InterfaceTranslator;
}) {
  return (
    <ul className="space-y-2.5 text-xs text-muted-foreground">
      {requests.map((request) => (
        <li
          className="min-w-0 border-border/50 border-b pb-2 last:border-b-0 last:pb-0"
          key={request.requestId}
        >
          <div className="wrap-break-word font-medium text-foreground">{request.tag}</div>
          <div className="mt-0.5 text-[10px] opacity-75">
            {translator.message("ui.slowRequests.started", {
              time: translator.date(new Date(request.startedAt), { timeStyle: "short" }),
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SlowRpcRequestToastCoordinator() {
  const translator = useInterfaceTranslator();
  const slowRequests = useSlowRpcAckRequests();
  const toastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);

  useEffect(() => {
    if (slowRequests.length === 0) {
      if (toastIdRef.current !== null) {
        toastManager.close(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    const nextToast = {
      data: {
        expandableContent: <SlowRequestDetails requests={slowRequests} translator={translator} />,
        expandableDescriptionTrigger: true,
        expandableLabels: {
          collapse: translator.message("ui.slowRequests.hide"),
          expand: translator.message("ui.slowRequests.show"),
        },
      },
      description: describeSlowRequests(slowRequests, translator),
      timeout: 0,
      title: translator.message("ui.slowRequests.title"),
      type: "warning" as const,
    };

    if (toastIdRef.current === null) {
      toastIdRef.current = toastManager.add(nextToast);
    } else {
      toastManager.update(toastIdRef.current, nextToast);
    }
  }, [slowRequests, translator]);

  useEffect(
    () => () => {
      if (toastIdRef.current !== null) {
        toastManager.close(toastIdRef.current);
      }
    },
    [],
  );

  return null;
}
