import {
  EasDeviceHostConfig,
  SimlockDeviceHostConfig,
  SshDeviceHostConfig,
  type DeviceHostConfig,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { parseSettingsInteger } from "./server-controls-settings";

const isSshDeviceHost = Schema.is(SshDeviceHostConfig);
const isEasDeviceHost = Schema.is(EasDeviceHostConfig);
const isSimlockDeviceHost = Schema.is(SimlockDeviceHostConfig);

export type DeviceHostDraft = Readonly<
  Record<
    | "label"
    | "target"
    | "identityFile"
    | "port"
    | "appId"
    | "credential"
    | "maxConcurrentSessions"
    | "maxSessionMinutes"
    | "idleMinutes"
    | "gatewayUrl"
    | "maxLeases"
    | "maxLeaseMinutes",
    string
  >
>;

export function deviceHostDraft(host: DeviceHostConfig): DeviceHostDraft {
  return {
    label: host.label,
    target: host.kind === "ssh" ? host.target : "",
    identityFile: host.kind === "ssh" ? (host.identityFile ?? "") : "",
    port: host.kind === "ssh" ? String(host.port ?? "") : "",
    appId: host.kind === "eas" ? (host.appId ?? "") : "",
    credential: "",
    maxConcurrentSessions: host.kind === "eas" ? String(host.maxConcurrentSessions) : "2",
    maxSessionMinutes: host.kind === "eas" ? String(host.maxSessionMinutes) : "30",
    idleMinutes: host.kind === "eas" ? String(host.idleMinutes) : "10",
    gatewayUrl: host.kind === "simlock" ? host.gatewayUrl : "",
    maxLeases: host.kind === "simlock" ? String(host.maxLeases) : "2",
    maxLeaseMinutes: host.kind === "simlock" ? String(host.maxLeaseMinutes) : "60",
  };
}

export function parseDeviceHostSettings(
  host: DeviceHostConfig,
  draft: DeviceHostDraft,
  credentialChanged: boolean,
): DeviceHostConfig | null {
  const base = { id: host.id, label: draft.label.trim() };
  if (host.kind === "ssh") {
    const port = draft.port.trim() ? parseSettingsInteger(draft.port, 1, 65535) : null;
    if (port === undefined) return null;
    const next = {
      ...base,
      kind: "ssh" as const,
      target: draft.target.trim(),
      ...(draft.identityFile.trim() ? { identityFile: draft.identityFile.trim() } : {}),
      ...(port === null ? {} : { port }),
    };
    return isSshDeviceHost(next) ? next : null;
  }
  if (host.kind === "eas") {
    const next = {
      ...base,
      kind: "eas" as const,
      ...(draft.appId.trim() ? { appId: draft.appId.trim() } : {}),
      accessToken: credentialChanged ? draft.credential.trim() : host.accessToken,
      maxConcurrentSessions: parseSettingsInteger(draft.maxConcurrentSessions, 1, 20),
      maxSessionMinutes: parseSettingsInteger(draft.maxSessionMinutes, 1, 115),
      idleMinutes: parseSettingsInteger(draft.idleMinutes, 1, 60),
    };
    return isEasDeviceHost(next) ? next : null;
  }
  const next = {
    ...base,
    kind: "simlock" as const,
    gatewayUrl: draft.gatewayUrl.trim(),
    agentToken: credentialChanged ? draft.credential.trim() : host.agentToken,
    maxLeases: parseSettingsInteger(draft.maxLeases, 1, 20),
    maxLeaseMinutes: parseSettingsInteger(draft.maxLeaseMinutes, 5, 240),
  };
  return isSimlockDeviceHost(next) ? next : null;
}
