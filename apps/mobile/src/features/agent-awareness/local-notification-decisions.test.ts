import { describe, expect, it } from "vite-plus/test";
import { createThreadNotificationGate } from "@t3tools/client-runtime/thread-notifications";

import {
  mobileNotificationBadgeCount,
  mobileNotificationDelivery,
} from "./local-notification-decisions";

describe("mobile local notifications", () => {
  it("delivers local background alerts independently of in-app preferences and avoids cloud duplicates", () => {
    const input = {
      foreground: false,
      onScreen: true,
      inAppEnabled: false,
      cloudPush: false,
      suppressed: false,
    };
    expect(mobileNotificationDelivery(input)).toEqual({ local: true, toast: false });
    expect(mobileNotificationDelivery({ ...input, cloudPush: true })).toEqual({
      local: false,
      toast: false,
    });
    expect(
      mobileNotificationDelivery({
        ...input,
        foreground: true,
        onScreen: false,
        inAppEnabled: true,
      }),
    ).toEqual({ local: false, toast: true });
    expect(mobileNotificationDelivery({ ...input, foreground: true, inAppEnabled: true })).toEqual({
      local: false,
      toast: false,
    });
    expect(mobileNotificationDelivery({ ...input, foreground: true, onScreen: false })).toEqual({
      local: false,
      toast: false,
    });
    expect(mobileNotificationDelivery({ ...input, suppressed: true })).toEqual({
      local: false,
      toast: false,
    });
  });

  it("does not replay history or repeated completions after reconnecting", () => {
    const notifications: string[] = [];
    const gate = createThreadNotificationGate<string>((key, kind) =>
      notifications.push(`${key}:${kind}`),
    );
    const options = { archived: false, quiet: false };
    const old = { attention: null, settled: true, completedAt: 10 };
    const working = { attention: null, settled: false, completedAt: null };
    const completed = { attention: null, settled: true, completedAt: 20 };
    gate.observe("thread", undefined, old, options);
    gate.observe("thread", old, working, options);
    gate.observe("thread", working, completed, options);
    gate.observe("thread", completed, completed, options);
    gate.observe("thread", working, completed, options);
    gate.observe("thread", completed, { ...working, attention: "run:approval" }, options);
    gate.observe("quiet", working, completed, { ...options, quiet: true });
    gate.observe("hidden", working, completed, { ...options, archived: true });
    expect(notifications).toEqual(["thread:completion", "thread:input"]);
  });

  it("counts each unread or attention thread once across environments and clears hidden or visible threads", () => {
    const states = [
      { key: "env1/a", attention: true, unread: true, hidden: false },
      { key: "env1/a", attention: true, unread: false, hidden: false },
      { key: "env2/a", attention: false, unread: true, hidden: false },
      { key: "env1/hidden", attention: true, unread: true, hidden: true },
      { key: "env1/read", attention: false, unread: false, hidden: false },
    ];
    expect(mobileNotificationBadgeCount(states, null)).toBe(2);
    expect(mobileNotificationBadgeCount(states, "env1/a")).toBe(1);
    expect(mobileNotificationBadgeCount([], null)).toBe(0);
  });
});
