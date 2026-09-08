import { describe, expect, it } from "vite-plus/test";

import {
  settingsDiagnosticsInterfaceCatalog,
  type SettingsDiagnosticsInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.diagnostics.ts";

const representativeKeys = [
  "settings.diagnostics.resourceMonitor.title",
  "settings.diagnostics.process.category.provider",
  "settings.diagnostics.signal.confirmKill",
  "settings.diagnostics.trace.latestFailures",
  "settings.diagnostics.table.logicalRead",
  "settings.diagnostics.sampleInterval",
] as const satisfies readonly SettingsDiagnosticsInterfaceMessageKey[];

describe("diagnostics settings interface catalog", () => {
  it("owns complete English, German, and French diagnostics chrome", () => {
    expect(
      representativeKeys.every((key) => settingsDiagnosticsInterfaceCatalog.keys.includes(key)),
    ).toBe(true);
    expect(new Set(settingsDiagnosticsInterfaceCatalog.keys).size).toBe(
      settingsDiagnosticsInterfaceCatalog.keys.length,
    );
    for (const language of ["en", "de", "fr"] as const) {
      for (const key of settingsDiagnosticsInterfaceCatalog.keys) {
        const message = settingsDiagnosticsInterfaceCatalog.messages[language][key];
        expect(message).toBeDefined();
        if (typeof message === "string") expect(message.trim()).not.toBe("");
      }
    }
  });

  it("preserves telemetry values as interpolation placeholders", () => {
    for (const language of ["en", "de", "fr"] as const) {
      expect(
        settingsDiagnosticsInterfaceCatalog.messages[language][
          "settings.diagnostics.signal.confirmKill"
        ],
      ).toContain("{{pid}}");
      const interval =
        settingsDiagnosticsInterfaceCatalog.messages[language][
          "settings.diagnostics.sampleInterval"
        ];
      expect(typeof interval).toBe("object");
      if (typeof interval === "object") {
        expect(interval.one).toContain("{{count}}");
        expect(interval.other).toContain("{{count}}");
      }
    }
  });

  it("does not catalog commands, trace payloads, raw errors, paths, or process identities", () => {
    expect(
      settingsDiagnosticsInterfaceCatalog.keys.some((key) =>
        /commandValue|tracePayload|errorDetail|pathValue|processIdentity/u.test(key),
      ),
    ).toBe(false);
  });
});
