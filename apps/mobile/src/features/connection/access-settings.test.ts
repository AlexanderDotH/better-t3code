import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  pairingScopePreset,
  pairingScopesForSession,
  shareablePairingUrl,
  togglePairingScope,
} from "./access-settings";

describe("pairing scope selection", () => {
  it("limits presets to granted scopes and honors explicitly empty permissions", () => {
    const session = {
      authenticated: true,
      permissions: [AuthOrchestrationReadScope, AuthAccessWriteScope],
    };
    expect(pairingScopesForSession(session, pairingScopePreset("standard"))).toEqual([
      AuthOrchestrationReadScope,
      AuthAccessWriteScope,
    ]);
    expect(
      pairingScopesForSession(
        { ...session, scopes: [AuthOrchestrationOperateScope], permissions: [] },
        pairingScopePreset("standard"),
      ),
    ).toEqual([]);
    expect(
      pairingScopesForSession({ ...session, authenticated: false }, [AuthAccessWriteScope]),
    ).toEqual([]);
    expect(pairingScopesForSession(null, pairingScopePreset("read"))).toEqual([]);
  });

  it("keeps terminal access observable and removes operate when read is removed", () => {
    const selected = togglePairingScope(
      [AuthOrchestrationReadScope],
      AuthTerminalOperateScope,
      true,
    );
    expect(selected).toEqual([
      AuthOrchestrationReadScope,
      AuthTerminalOperateScope,
      AuthTerminalReadScope,
    ]);
    expect(togglePairingScope(selected, AuthTerminalOperateScope, true)).toHaveLength(3);
    expect(togglePairingScope(selected, AuthTerminalReadScope, false)).toEqual([
      AuthOrchestrationReadScope,
    ]);
    expect(
      pairingScopesForSession(
        { authenticated: true, permissions: [AuthTerminalOperateScope] },
        selected,
      ),
    ).toEqual([]);
    expect(
      pairingScopesForSession(
        { authenticated: true, permissions: [AuthTerminalOperateScope, AuthTerminalReadScope] },
        [AuthTerminalOperateScope],
      ),
    ).toEqual([AuthTerminalOperateScope, AuthTerminalReadScope]);
  });
});

describe("shareablePairingUrl", () => {
  it("uses a fragment credential and drops unrelated paths and queries", () => {
    const value = shareablePairingUrl(
      "https://box.example.test/threads/123?token=old#old",
      "one+time&code",
    );
    expect(value).not.toBeNull();
    const url = new URL(value!);
    expect(url.pathname).toBe("/pair");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe("one+time&code");
  });

  it.each([
    "http://localhost:3000",
    "http://127.12.0.1:7331",
    "http://[::1]:7331",
    "https://user:password@box.test",
    "file:///tmp/test",
    "not a url",
  ])("does not share unsafe or device-local endpoint %s", (address) => {
    expect(shareablePairingUrl(address, "credential")).toBeNull();
  });
});
