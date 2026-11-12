import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import {
  backgroundConnectionNotification,
  backgroundConnectionShouldRun,
} from "./background-connection";

describe("Android background connection", () => {
  it.each([
    {
      platform: "android",
      enabled: true,
      configured: 1,
      connected: 1,
      running: false,
      expected: true,
    },
    {
      platform: "android",
      enabled: false,
      configured: 1,
      connected: 1,
      running: true,
      expected: false,
    },
    { platform: "ios", enabled: true, configured: 1, connected: 1, running: true, expected: false },
    { platform: "web", enabled: true, configured: 1, connected: 1, running: true, expected: false },
    {
      platform: "android",
      enabled: true,
      configured: 0,
      connected: 0,
      running: true,
      expected: false,
    },
    {
      platform: "android",
      enabled: true,
      configured: 2,
      connected: 0,
      running: false,
      expected: false,
    },
    {
      platform: "android",
      enabled: true,
      configured: 2,
      connected: 0,
      running: true,
      expected: true,
    },
    {
      platform: "android",
      enabled: true,
      configured: 3,
      connected: 2,
      running: true,
      expected: true,
    },
  ])(
    "decides whether to run for $platform / enabled=$enabled / configured=$configured / connected=$connected / running=$running",
    ({ platform, enabled, configured, connected, running, expected }) => {
      expect(
        backgroundConnectionShouldRun({
          platform,
          enabled,
          configuredEnvironmentCount: configured,
          connectedEnvironmentCount: connected,
          running,
        }),
      ).toBe(expected);
    },
  );

  it.each([
    ["en", "en-US", "Connected to 1 server", "Connected to 3 servers", "Reconnecting to servers…"],
    [
      "de",
      "de-DE",
      "Mit 1 Server verbunden",
      "Mit 3 Servern verbunden",
      "Verbindung zu Servern wird wiederhergestellt…",
    ],
    ["fr", "fr-FR", "Connecté à 1 serveur", "Connecté à 3 serveurs", "Reconnexion aux serveurs…"],
  ] as const)(
    "describes connected servers and reconnecting in %s",
    (language, locale, one, many, reconnecting) => {
      const translator = createInterfaceTranslator({ language, locale });
      expect(backgroundConnectionNotification(1, translator)).toMatchObject({
        title: "Better T3 Code",
        body: one,
      });
      expect(backgroundConnectionNotification(3, translator).body).toBe(many);
      expect(backgroundConnectionNotification(0, translator).body).toBe(reconnecting);
      expect(backgroundConnectionNotification(1, translator).channelName).not.toContain(
        "mobile.insights.",
      );
    },
  );
});
