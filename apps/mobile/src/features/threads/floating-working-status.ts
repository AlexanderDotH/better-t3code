import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { ThreadTokenUsage } from "@t3tools/client-runtime/thread-token-usage";

export interface FloatingStatusAction {
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}

export type FloatingWorkingStatus =
  | {
      readonly kind: "working";
      readonly startedAt: string;
      readonly tokenUsage: ThreadTokenUsage | null;
      /** The header carries the elapsed time, so only the totals stay here. */
      readonly durationInHeader: boolean;
      readonly onOpenTokenUsage: () => void;
    }
  | { readonly kind: "syncing"; readonly label: string }
  | { readonly kind: "compacting" }
  | {
      readonly kind: "child-input";
      readonly label: string;
      readonly accessibilityLabel: string;
      readonly onPress: () => void;
    }
  | {
      readonly kind: "background";
      readonly label: string;
      readonly accessibilityLabel: string;
      readonly waiting: boolean;
      readonly onPress: () => void;
      readonly action: FloatingStatusAction;
    }
  | {
      readonly kind: "lifecycle";
      readonly state: "snoozed" | "settled" | "woke";
      readonly label: string;
      readonly action: FloatingStatusAction;
    }
  | {
      readonly kind: "stop";
      readonly label: string;
      readonly unresponsive: boolean;
      readonly action: FloatingStatusAction | null;
    }
  | { readonly kind: "goal"; readonly label: string; readonly accessibilityLabel: string }
  | { readonly kind: "preparing"; readonly label: string }
  | {
      readonly kind: "connection";
      readonly tone: "reconnecting" | "unavailable";
      readonly label: string;
      readonly onPress: () => void;
    };

export function connectionFloatingStatus(input: {
  readonly translator: InterfaceTranslator;
  readonly connectionError: string | null;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly environmentLabel: string | null;
  readonly onReconnect: () => void;
}): FloatingWorkingStatus | null {
  const environment = input.environmentLabel ?? "Environment";
  const { translator } = input;
  const unavailable = (label: string): FloatingWorkingStatus => ({
    kind: "connection",
    tone: "unavailable",
    label,
    onPress: input.onReconnect,
  });

  switch (input.connectionState) {
    case "connecting":
    case "reconnecting":
      return {
        kind: "connection",
        tone: "reconnecting",
        label:
          input.connectionError === null
            ? translator.message("mobile.thread.reconnecting", { environment })
            : translator.message("mobile.thread.reconnectingAfterFailure", { environment }),
        onPress: input.onReconnect,
      };
    case "offline":
      return unavailable("You are offline");
    case "unsupported":
      return unavailable("Client not supported");
    case "error":
      return unavailable(
        input.connectionError
          ? translator.message("mobile.thread.connectionFailedWithError", {
              environment,
              error: input.connectionError,
            })
          : translator.message("mobile.thread.connectionFailed", { environment }),
      );
    case "available":
      return unavailable(translator.message("mobile.thread.notConnected", { environment }));
    case "connected":
      return null;
  }
}
