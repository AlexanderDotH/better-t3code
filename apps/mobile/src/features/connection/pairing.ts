import { readHostedPairingRequest, resolveRemotePairingTarget } from "@t3tools/shared/remote";
import * as Schema from "effect/Schema";

import type { PairingOnboardingStage } from "../../connection/onboarding";

const MOBILE_PAIRING_URL_PARAM = "pairingUrl";

export interface PairingDestinationReview {
  readonly destination: string;
  readonly transport: "HTTP" | "HTTPS";
  readonly encrypted: boolean;
  readonly transportDetail: "Encrypted connection" | "Unencrypted HTTP connection";
}

export interface PairingRouteParams {
  readonly pairingUrl?: string;
  readonly autoConnect?: string;
}

function isIpLiteral(host: string): boolean {
  try {
    const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "");
    if (hostname.includes(":")) return true;

    const octets = hostname.split(".");
    return (
      octets.length === 4 &&
      octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
    );
  } catch {
    return false;
  }
}

export class PairingQrPayloadEmptyError extends Schema.TaggedErrorClass<PairingQrPayloadEmptyError>()(
  "PairingQrPayloadEmptyError",
  {},
) {
  override get message(): string {
    return "Scanned QR code did not contain a pairing URL.";
  }
}

export function buildPairingUrl(host: string, code: string): string {
  const h = host.trim();
  const c = code.trim();
  if (!h) return "";
  if (!c) return h;

  try {
    const url = new URL(h.includes("://") ? h : `${isIpLiteral(h) ? "http" : "https"}://${h}`);
    url.hash = new URLSearchParams([["token", c]]).toString();
    return url.toString();
  } catch {
    return `${h}#token=${c}`;
  }
}

export function parsePairingUrl(url: string): { host: string; code: string } {
  const trimmed = url.trim();
  if (!trimmed) return { host: "", code: "" };

  try {
    const parsed = new URL(trimmed);
    const hostedPairingRequest = readHostedPairingRequest(parsed);
    if (hostedPairingRequest) {
      return {
        host: hostedPairingRequest.host.replace(/\/$/, ""),
        code: hostedPairingRequest.token,
      };
    }

    const hashParams = new URLSearchParams(parsed.hash.slice(1));
    const hashToken = hashParams.get("token");
    const queryToken = parsed.searchParams.get("token");
    const code = hashToken || queryToken || "";

    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = "/";
    return { host: parsed.toString().replace(/\/$/, ""), code };
  } catch {
    return { host: trimmed, code: "" };
  }
}

export function describePairingDestination(pairingUrl: string): PairingDestinationReview {
  const { host, code } = parsePairingUrl(pairingUrl);
  if (host.trim().length === 0) {
    throw new Error("Enter a host address.");
  }
  if (code.trim().length === 0) {
    throw new Error("Enter a pairing code.");
  }

  const target = resolveRemotePairingTarget({ pairingUrl: buildPairingUrl(host, code) });
  const destination = target.httpBaseUrl.replace(/\/$/, "");
  const encrypted = new URL(target.httpBaseUrl).protocol === "https:";
  return {
    destination,
    transport: encrypted ? "HTTPS" : "HTTP",
    encrypted,
    transportDetail: encrypted ? "Encrypted connection" : "Unencrypted HTTP connection",
  };
}

export function resolvePairingRouteIntent(
  params: PairingRouteParams,
  isDevelopment: boolean,
): { readonly pairingUrl: string; readonly shouldAutoConnect: boolean } {
  const pairingUrl = params.pairingUrl?.trim() ?? "";
  const autoConnectRequested = params.autoConnect === "1" || params.autoConnect === "true";
  return {
    pairingUrl,
    shouldAutoConnect: isDevelopment && pairingUrl.length > 0 && autoConnectRequested,
  };
}

const PAIRING_STAGE_LABELS = {
  validating: "Validating details...",
  "checking-host": "Checking host...",
  "validating-code": "Validating pairing code...",
  saving: "Saving environment...",
} satisfies Record<PairingOnboardingStage, string>;

const PAIRING_FAILURE_GUIDANCE = {
  validating: "Check the host address and pairing code.",
  "checking-host":
    "Could not reach this host. Check that the address is correct and reachable from this device.",
  "validating-code":
    "The host was found, but the pairing code was rejected or expired. Generate a new pairing code and try again.",
  saving: "The host accepted the pairing code, but this device could not save the environment.",
} satisfies Record<PairingOnboardingStage, string>;

export function pairingStageLabel(stage: PairingOnboardingStage): string {
  return PAIRING_STAGE_LABELS[stage];
}

export function pairingFailureMessage(stage: PairingOnboardingStage, detail: string): string {
  const trimmedDetail = detail.trim();
  return trimmedDetail.length === 0
    ? PAIRING_FAILURE_GUIDANCE[stage]
    : `${PAIRING_FAILURE_GUIDANCE[stage]} ${trimmedDetail}`;
}

export function extractPairingUrlFromQrPayload(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed) {
    throw new PairingQrPayloadEmptyError({});
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "t3code:") {
      const pairingUrl = url.searchParams.get(MOBILE_PAIRING_URL_PARAM)?.trim() ?? "";
      if (pairingUrl.length > 0) {
        return pairingUrl;
      }
    }
  } catch {
    // Treat non-URL payloads as raw pairing-url text so the normal input validation can decide.
  }

  return trimmed;
}
