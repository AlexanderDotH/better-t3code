import { type EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

export type ThreadContentPresentation =
  | { readonly kind: "ready" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "unavailable";
      readonly title: string;
      readonly detail: string;
    };

export function projectThreadContentPresentation(input: {
  readonly hasDetail: boolean;
  readonly detailError: string | null;
  readonly detailDeleted: boolean;
  readonly connectionState: EnvironmentConnectionPhase;
}): ThreadContentPresentation {
  if (input.hasDetail) {
    return { kind: "ready" };
  }
  if (input.detailDeleted) {
    return {
      kind: "unavailable",
      title: currentInterfaceTranslator().message("mobile.terminal.threadUnavailable"),
      detail: currentInterfaceTranslator().message("mobile.ui.thisThreadWasDeletedOrIsNo"),
    };
  }
  if (input.detailError !== null) {
    return {
      kind: "unavailable",
      title: currentInterfaceTranslator().message("mobile.ui.couldNotLoadConversation"),
      detail: input.detailError,
    };
  }
  if (
    input.connectionState === "connected" ||
    input.connectionState === "connecting" ||
    input.connectionState === "reconnecting"
  ) {
    return { kind: "loading" };
  }
  return {
    kind: "unavailable",
    title: currentInterfaceTranslator().message("mobile.ui.messagesNotCached"),
    detail: currentInterfaceTranslator().message(
      "mobile.ui.reconnectThisEnvironmentToLoadTheConversation",
    ),
  };
}
