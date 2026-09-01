import type {
  ProviderAuthConnectEvent,
  ProviderAuthFlow,
  ServerProviderAuth,
  ServerProviderAuthCredential,
  ServerProviderRateLimit,
} from "@t3tools/contracts";

export type ProviderSubscriptionAction = "connect" | "reconnect" | "set-credential" | "disconnect";

export interface ProviderSubscriptionSnapshot {
  readonly providerName: string;
  readonly auth: ServerProviderAuth;
  readonly message?: string | undefined;
  readonly rateLimit?: ServerProviderRateLimit | undefined;
}

export interface ProviderSubscriptionPresentation {
  readonly action: ProviderSubscriptionAction;
  readonly actionLabel: string;
  readonly providerName: string;
  readonly flows: ReadonlyArray<ProviderAuthFlow>;
  readonly credential: ServerProviderAuthCredential | null;
  readonly canDisconnect: boolean;
  readonly environmentCredential: boolean;
  readonly account: string | null;
  readonly plan: string | null;
  readonly rateLimit: string | null;
  readonly tone: "neutral" | "warning" | "error";
}

export type ProviderAuthDialogState =
  | { readonly status: "idle" | "starting" | "connected" | "cancelled" }
  | { readonly status: "browser"; readonly authorizationUrl: string }
  | {
      readonly status: "device-code";
      readonly verificationUrl: string;
      readonly userCode: string;
    }
  | { readonly status: "failed"; readonly message: string };

export type ProviderAuthDialogEvent = Exclude<ProviderAuthDialogState, { readonly status: "idle" }>;

function subscriptionActionLabel(
  action: ProviderSubscriptionAction,
  credential: ServerProviderAuthCredential | null,
  authenticated: boolean,
): string {
  if (action === "connect") return "Connect";
  if (action === "reconnect") return "Reconnect";
  if (action === "set-credential") {
    return `${authenticated ? "Replace" : "Add"} ${credential?.label ?? "credential"}`;
  }
  return "Disconnect";
}

function rateLimitLabel(snapshot: ProviderSubscriptionSnapshot): string | null {
  const rateLimit = snapshot.rateLimit;
  if (rateLimit?.status === "limited" || rateLimit?.status === "exhausted") {
    if (rateLimit.message) return rateLimit.message;
    if (rateLimit.retryAfterSeconds !== undefined) {
      const minutes = Math.ceil(rateLimit.retryAfterSeconds / 60);
      return `Rate limited · Retry in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    }
    return rateLimit.status === "exhausted" ? "Rate limit exhausted" : "Rate limited";
  }
  return null;
}

export function deriveProviderSubscriptionPresentation(
  snapshot: ProviderSubscriptionSnapshot,
): ProviderSubscriptionPresentation | null {
  const capabilities = snapshot.auth.capabilities;
  const credential = capabilities?.credential ?? null;
  const hasInteractiveFlow = (capabilities?.flows.length ?? 0) > 0;
  if (!credential && !hasInteractiveFlow && !capabilities?.canDisconnect) return null;

  const authenticated = snapshot.auth.status === "authenticated";
  const reconnect =
    snapshot.auth.status === "expired" ||
    snapshot.auth.status === "error" ||
    (!authenticated && hasInteractiveFlow && Boolean(snapshot.message));
  const action: ProviderSubscriptionAction =
    credential !== null
      ? "set-credential"
      : authenticated && capabilities?.canDisconnect
        ? "disconnect"
        : reconnect
          ? "reconnect"
          : "connect";
  const rateLimit = rateLimitLabel(snapshot);
  return {
    action,
    actionLabel: subscriptionActionLabel(action, credential, authenticated),
    providerName: snapshot.providerName,
    flows: capabilities?.flows ?? [],
    credential,
    canDisconnect: authenticated && Boolean(capabilities?.canDisconnect),
    environmentCredential: authenticated && credential !== null && !capabilities?.canDisconnect,
    account:
      snapshot.auth.email?.trim() ||
      snapshot.auth.label?.trim() ||
      snapshot.auth.accountId?.trim() ||
      null,
    plan: snapshot.auth.plan?.label.trim() || null,
    rateLimit,
    tone:
      snapshot.rateLimit?.status === "limited" || snapshot.rateLimit?.status === "exhausted"
        ? "warning"
        : reconnect
          ? "error"
          : "neutral",
  };
}

export function toProviderAuthDialogEvent(
  event: ProviderAuthConnectEvent,
): ProviderAuthDialogEvent {
  switch (event.type) {
    case "starting":
      return { status: "starting" };
    case "browserChallenge":
      return { status: "browser", authorizationUrl: event.authorizationUrl };
    case "deviceCodeChallenge":
      return {
        status: "device-code",
        verificationUrl: event.verificationUrl,
        userCode: event.userCode,
      };
    case "connected":
      return { status: "connected" };
    case "failed":
      return { status: "failed", message: event.failure.reason };
    case "cancelled":
      return { status: "cancelled" };
  }
}

export function reduceProviderAuthDialogState(
  _current: ProviderAuthDialogState,
  event: ProviderAuthDialogEvent,
): ProviderAuthDialogState {
  return event;
}
