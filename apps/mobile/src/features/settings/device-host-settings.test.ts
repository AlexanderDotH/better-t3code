import {
  DeviceHostId,
  type EasDeviceHostConfig,
  type SimlockDeviceHostConfig,
  type SshDeviceHostConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { deviceHostDraft, parseDeviceHostSettings } from "./device-host-settings";

describe("mobile device host drafts", () => {
  const ssh: SshDeviceHostConfig = {
    kind: "ssh",
    id: DeviceHostId.make("mac"),
    label: "Mac",
    target: "user@mac",
    identityFile: "/server/key",
    port: 22,
  };
  const eas: EasDeviceHostConfig = {
    kind: "eas",
    id: DeviceHostId.make("eas"),
    label: "EAS",
    appId: "app",
    accessToken: "saved-secret-placeholder",
    maxConcurrentSessions: 2,
    maxSessionMinutes: 30,
    idleMinutes: 10,
  };
  const simlock: SimlockDeviceHostConfig = {
    kind: "simlock",
    id: DeviceHostId.make("simlock"),
    label: "Simlock",
    gatewayUrl: "https://gateway.example.com",
    agentToken: "saved-token-placeholder",
    maxLeases: 2,
    maxLeaseMinutes: 60,
  };

  it("preserves saved credentials until replacement or clear", () => {
    for (const host of [eas, simlock]) {
      const draft = { ...deviceHostDraft(host), label: " Renamed " };
      expect(parseDeviceHostSettings(host, draft, false)).toEqual({ ...host, label: "Renamed" });
      const key = host.kind === "eas" ? "accessToken" : "agentToken";
      expect(
        parseDeviceHostSettings(host, { ...draft, credential: " replacement " }, true),
      ).toMatchObject({ [key]: "replacement" });
      expect(parseDeviceHostSettings(host, draft, true)).toMatchObject({ [key]: "" });
    }
  });

  it("validates SSH targets and ports and removes cleared optional fields", () => {
    const draft = deviceHostDraft(ssh);
    expect(parseDeviceHostSettings(ssh, draft, false)).toEqual(ssh);
    for (const port of ["0", "65536", "22.5", "22ssh"])
      expect(parseDeviceHostSettings(ssh, { ...draft, port }, false)).toBeNull();
    for (const target of ["", "-oProxyCommand=bad", "user @host"])
      expect(parseDeviceHostSettings(ssh, { ...draft, target }, false)).toBeNull();
    const cleared = parseDeviceHostSettings(ssh, { ...draft, identityFile: "", port: "" }, false);
    expect(cleared).not.toHaveProperty("identityFile");
    expect(cleared).not.toHaveProperty("port");
  });

  it("rejects unbounded EAS sessions and invalid Simlock gateways or leases", () => {
    const draft = deviceHostDraft(eas);
    for (const change of [
      { maxSessionMinutes: "116" },
      { idleMinutes: "30" },
      { maxConcurrentSessions: "21" },
    ])
      expect(parseDeviceHostSettings(eas, { ...draft, ...change }, false)).toBeNull();
    const simlockDraft = deviceHostDraft(simlock);
    for (const change of [
      { gatewayUrl: "https://gateway.example.com/path" },
      { gatewayUrl: "file:///tmp/gateway" },
      { maxLeases: "0" },
      { maxLeaseMinutes: "241" },
    ])
      expect(parseDeviceHostSettings(simlock, { ...simlockDraft, ...change }, false)).toBeNull();
  });
});
