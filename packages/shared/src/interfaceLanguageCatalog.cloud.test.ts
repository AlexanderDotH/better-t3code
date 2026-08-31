import { describe, expect, it } from "vite-plus/test";
import { translateInterfaceMessage } from "./interfaceLanguage.ts";

import {
  cloudInterfaceCatalog,
  type CloudInterfaceMessageKey,
} from "./interfaceLanguageCatalog.cloud.ts";

const representativeKeys = [
  "serverUpdate.copy.successDescription",
  "pairing.hosted.failureWithRetry",
  "mobileClients.notifications.alertsEnabled",
  "t3Connect.deregister.confirmDescription",
  "connectCli.callback.accountDescription",
  "connectOnboarding.publishEnvironment.description",
  "relayInstall.versionDescription",
  "sshPassword.description",
  "desktopUpdate.downloadedDescription",
  "usage.coverage.failed",
  "usage.deviceScanning",
  "root.error.unexpected",
] as const satisfies readonly CloudInterfaceMessageKey[];

function placeholders(template: string): readonly string[] {
  return [...template.matchAll(/{{([A-Za-z0-9_]+)}}/g)]
    .map((match) => match[1] ?? "")
    .filter(Boolean)
    .toSorted();
}

describe("cloud interface catalog", () => {
  it("ships complete English, German, and French messages", () => {
    expect(new Set(cloudInterfaceCatalog.keys).size).toBe(cloudInterfaceCatalog.keys.length);
    expect(representativeKeys.every((key) => cloudInterfaceCatalog.keys.includes(key))).toBe(true);

    for (const language of ["en", "de", "fr"] as const) {
      for (const key of cloudInterfaceCatalog.keys) {
        const template = cloudInterfaceCatalog.messages[language][key];
        if (typeof template === "string") {
          expect(template.trim(), `${language}:${key}`).not.toBe("");
          continue;
        }
        expect(template.one.trim(), `${language}:${key}:one`).not.toBe("");
        expect(template.other.trim(), `${language}:${key}:other`).not.toBe("");
      }
    }
  });

  it("keeps interpolation placeholders identical across locales", () => {
    for (const key of cloudInterfaceCatalog.keys) {
      const english = cloudInterfaceCatalog.messages.en[key];
      const expected = placeholders(typeof english === "string" ? english : english.other);
      for (const language of ["de", "fr"] as const) {
        const localized = cloudInterfaceCatalog.messages[language][key];
        expect(
          placeholders(typeof localized === "string" ? localized : localized.other),
          `${language}:${key}`,
        ).toEqual(expected);
      }
    }
  });

  it("uses typed fallbacks while leaving external values as placeholders", () => {
    expect(cloudInterfaceCatalog.messages.en["root.error.unexpected"]).toBe(
      "An unexpected router error occurred.",
    );
    expect(cloudInterfaceCatalog.messages.de["sshPassword.failureFallback"]).toBe(
      "Die SSH-Passwortabfrage ist fehlgeschlagen.",
    );
    expect(cloudInterfaceCatalog.messages.fr["serverUpdate.copy.failureTitle"]).toBe(
      "Impossible de copier la commande de mise à jour",
    );
    expect(cloudInterfaceCatalog.messages.en["usage.coverage.failed"]).toContain("{{environment}}");
    expect(cloudInterfaceCatalog.messages.en["pairing.hosted.failureWithRetry"]).toContain(
      "{{error}}",
    );
  });

  it("interpolates external values without translating or rewriting them", () => {
    expect(
      translateInterfaceMessage("de", "serverUpdate.copy.successDescription", {
        command: "npx t3@2026.8.30",
        server: "prod-eu-1",
      }),
    ).toContain("`npx t3@2026.8.30` auf prod-eu-1");
    expect(
      translateInterfaceMessage("fr", "pairing.hosted.failureWithRetry", {
        error: "HTTP 431 from edge.example.test",
      }),
    ).toContain("HTTP 431 from edge.example.test");
    expect(
      translateInterfaceMessage("de", "usage.coverage.duplicates", {
        sources: "/srv/a, /srv/b",
      }),
    ).toContain("/srv/a, /srv/b");
  });
});
