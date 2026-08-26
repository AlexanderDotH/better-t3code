import type { InterfaceLanguageSyncRecord } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { planInterfaceLanguageSync } from "./interfaceLanguageSync.ts";

const record = (
  preference: InterfaceLanguageSyncRecord["preference"],
  updatedAt: number,
  updateId: string,
): InterfaceLanguageSyncRecord => ({ preference, updatedAt, updateId });

describe("interface language sync", () => {
  it("adopts the newest connected preference and propagates it", () => {
    const local = record("system", 10, "web:a");
    const remote = record("de", 20, "mobile:b");
    const plan = planInterfaceLanguageSync({
      localRecord: local,
      environments: [
        {
          environmentId: "environment-a",
          environmentSettingsVersion: 4,
          connected: true,
          record: remote,
        },
        {
          environmentId: "environment-b",
          environmentSettingsVersion: 4,
          connected: true,
          record: local,
        },
      ],
    });

    expect(plan.winner).toEqual(remote);
    expect(plan.nextLocalRecord).toEqual(remote);
    expect(plan.writes).toEqual([{ environmentId: "environment-b", record: remote }]);
  });

  it("does not write to environments that predate language sync", () => {
    const plan = planInterfaceLanguageSync({
      localRecord: record("en", 10, "web:a"),
      environments: [
        {
          environmentId: "legacy",
          environmentSettingsVersion: 3,
          connected: true,
          record: null,
        },
      ],
    });

    expect(plan.writes).toEqual([]);
    expect(plan.unsupportedEnvironmentIds).toEqual(["legacy"]);
  });
});
