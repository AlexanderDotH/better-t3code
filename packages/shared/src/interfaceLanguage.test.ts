import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { BETTER_T3_FEATURE_REGISTRY } from "@t3tools/contracts";

import {
  createInterfaceTranslator,
  INTERFACE_MESSAGE_KEYS,
  pseudoLocalizeInterfaceMessage,
  resolveInterfaceLocale,
  translateInterfaceMessage,
  type InterfaceMessageKey,
} from "./interfaceLanguage.ts";

const crossSurfaceKeys = [
  "settings.betterT3.title",
  "chat.agent.heading",
  "sidebar.toggleMain",
  "ui.commandPalette.label",
  "cloud.action.continue",
  "git.common.branch",
  "browser.device.responsive",
  "settings.betterT3.section.agent-workflows",
  "settings.betterT3.providers.additionalHeading",
  "knowledgeGraph.search.placeholder",
  "knowledgeGraph.clearConfirm.description",
  "knowledgeGraph.nodeKind.architecture",
  "knowledgeGraph.edgeKind.co-changes-with",
  "knowledgeGraph.status.rate-limited",
  "knowledgeGraph.indexedFileCount",
  "knowledgeGraph.nodeCount",
  "knowledgeGraph.accessibility.relationship",
  "common.rebuild",
  "betterT3.agent.autoReasoningModel.label",
  "betterT3.agent.autoReasoningModel.description",
  "chat.traits.auto",
  "chat.traits.autoDescription",
  "chat.traits.fallback",
  "usage.calls.auto-reasoning",
  "mobile.usage.calls.auto-reasoning",
] as const satisfies readonly InterfaceMessageKey[];

const betterT3ValueKeys = [
  "settings.betterT3.value.automatic",
  "settings.betterT3.value.unavailable",
  "settings.betterT3.value.current",
  "settings.betterT3.value.classic",
  "settings.betterT3.value.updated",
  "settings.betterT3.value.created",
  "settings.betterT3.value.manual",
  "settings.betterT3.value.nativeLanguage",
  "settings.betterT3.value.english",
  "settings.betterT3.value.off",
  "settings.betterT3.value.lite",
  "settings.betterT3.value.full",
  "settings.betterT3.value.ultra",
  "settings.betterT3.value.days",
  "settings.betterT3.value.settleOnMerge",
  "settings.betterT3.value.projectSort",
  "settings.betterT3.value.threadSort",
  "settings.betterT3.value.pauseAll",
  "settings.betterT3.value.resumeAll",
  "settings.betterT3.value.projectCount",
] as const satisfies readonly InterfaceMessageKey[];

const betterT3PreviewKeys = [
  "settings.betterT3.section.interface",
  "settings.betterT3.preview.live",
  "settings.betterT3.preview.agent.title",
  "settings.betterT3.preview.agent.description",
  "settings.betterT3.preview.agent.prompt",
  "settings.betterT3.preview.agent.plan",
  "settings.betterT3.preview.agent.build",
  "settings.betterT3.preview.agent.improved",
  "settings.betterT3.preview.agent.workflow",
  "settings.betterT3.preview.agent.coordinated",
  "settings.betterT3.preview.agent.agent",
  "settings.betterT3.preview.agent.planner",
  "settings.betterT3.preview.agent.implementer",
  "settings.betterT3.preview.agent.reviewer",
  "settings.betterT3.preview.agent.reasoning",
  "settings.betterT3.preview.chat.title",
  "settings.betterT3.preview.chat.description",
  "settings.betterT3.preview.chat.response",
  "settings.betterT3.preview.chat.mcp",
  "settings.betterT3.preview.chat.git",
  "settings.betterT3.preview.chat.prompt",
] as const satisfies readonly InterfaceMessageKey[];

const mobileSettingsKeys = [
  "mobile.agentActivity.failed",
  "mobile.agentActivity.done",
  "mobile.agentActivity.outcomeFailed",
  "mobile.agentActivity.outcomeCompleted",
  "mobile.agentActivity.activeAgents",
  "mobile.agentActivity.needsAttention",
  "mobile.agentActivity.active",
  "mobile.agentActivity.approval",
  "mobile.agentActivity.input",
  "mobile.settings.title",
  "mobile.settings.close",
  "mobile.settings.section.account",
  "mobile.settings.section.configuration",
  "mobile.settings.section.appearance",
  "mobile.settings.section.general",
  "mobile.settings.section.app",
  "mobile.settings.section.threads",
  "mobile.settings.environments",
  "mobile.settings.agentsServers",
  "mobile.settings.account",
  "mobile.settings.account.localDescription",
  "mobile.settings.checking",
  "mobile.settings.signIn",
  "mobile.settings.signedIn",
  "mobile.settings.deviceNotifications",
  "mobile.settings.liveActivityUpdates",
  "mobile.settings.projects",
  "mobile.settings.projectGrouping",
  "mobile.settings.autoSettleMergedThreads",
  "mobile.settings.usage",
  "mobile.settings.clientStorage",
  "mobile.settings.legal",
  "mobile.settings.versionLabel",
  "mobile.settings.version",
  "mobile.settings.update.failed",
  "mobile.settings.update.checking",
  "mobile.settings.update.downloading",
  "mobile.settings.update.ready",
  "mobile.settings.update.restarting",
  "mobile.settings.update.current",
  "mobile.settings.archivedThreads",
  "mobile.settings.notifications.unavailable",
  "mobile.settings.notifications.permissionFailure",
  "mobile.settings.notifications.enabled",
  "mobile.settings.notifications.enabledDescription",
  "mobile.settings.notifications.registrationFailedTitle",
  "mobile.settings.notifications.registrationFailedDescription",
  "mobile.settings.notifications.iosOnly",
  "mobile.settings.notifications.disabled",
  "mobile.settings.notifications.disabledDescription",
  "mobile.settings.notifications.deniedDescription",
  "mobile.settings.notifications.openSettings",
  "mobile.settings.notifications.disableTitle",
  "mobile.settings.notifications.disableDescription",
  "mobile.settings.connect.signInTitle",
  "mobile.settings.connect.signInDescription",
  "mobile.settings.connect.continue",
  "mobile.settings.liveActivities.unavailable",
  "mobile.settings.liveActivities.enableFailure",
  "mobile.settings.liveActivities.enabled",
  "mobile.settings.liveActivities.linkedCount",
  "mobile.settings.liveActivities.enabledNoEnvironment",
  "mobile.settings.liveActivities.registrationFailedTitle",
  "mobile.settings.liveActivities.registrationFailedDescription",
  "mobile.settings.liveActivities.disableTitle",
  "mobile.settings.liveActivities.disableDescription",
  "mobile.settings.projects.settings.title",
  "mobile.settings.projects.settings.updateFailed",
  "mobile.settings.projects.settings.saveFailed",
  "mobile.settings.projects.settings.workspaceTitle",
  "mobile.settings.projects.settings.environmentDefault",
  "mobile.settings.projects.settings.projectDirectory",
  "mobile.settings.projects.settings.newWorktree",
  "mobile.settings.projects.settings.cancel",
  "mobile.settings.projects.settings.unsupported",
  "mobile.settings.projects.settings.checkpoints",
  "mobile.settings.projects.settings.defaultModel",
  "mobile.settings.projects.settings.unavailable",
  "mobile.settings.projects.settings.graphRequiresUpdate",
  "mobile.settings.projects.settings.graphExplore",
  "mobile.settings.projects.settings.graphEnable",
  "mobile.settings.projects.settings.empty",
  "mobile.settings.betterT3.updateFailedTitle",
  "mobile.settings.betterT3.updateFailedDescription",
] as const satisfies readonly InterfaceMessageKey[];

describe("interface language", () => {
  it("ships complete English, German, and French catalogs for every shared key", () => {
    expect(new Set(INTERFACE_MESSAGE_KEYS).size).toBe(INTERFACE_MESSAGE_KEYS.length);
    expect(crossSurfaceKeys.every((key) => INTERFACE_MESSAGE_KEYS.includes(key))).toBe(true);
    const knownKeys = new Set<string>(INTERFACE_MESSAGE_KEYS);
    for (const descriptor of BETTER_T3_FEATURE_REGISTRY) {
      expect(knownKeys.has(descriptor.labelMessageId)).toBe(true);
      expect(knownKeys.has(descriptor.descriptionMessageId)).toBe(true);
    }
    for (const language of ["en", "de", "fr"] as const) {
      for (const key of INTERFACE_MESSAGE_KEYS) {
        expect(
          translateInterfaceMessage(language, key, {
            count: 2,
            environments: "T3",
            label: "Node",
            relationship: "uses",
            source: "src/index.ts",
            target: "Package",
            version: "1.0.0",
          }),
        ).not.toBe(key);
      }
    }
  });

  it("ships Auto reasoning controls and usage labels on web and mobile", () => {
    for (const language of ["en", "de", "fr"] as const) {
      expect(
        translateInterfaceMessage(language, "betterT3.agent.autoReasoningModel.label"),
      ).not.toBe("betterT3.agent.autoReasoningModel.label");
      expect(translateInterfaceMessage(language, "chat.traits.auto")).not.toBe("chat.traits.auto");
      expect(translateInterfaceMessage(language, "usage.calls.auto-reasoning")).not.toBe(
        "usage.calls.auto-reasoning",
      );
      expect(translateInterfaceMessage(language, "mobile.usage.calls.auto-reasoning")).not.toBe(
        "mobile.usage.calls.auto-reasoning",
      );
    }
  });

  it("ships typed mobile settings messages with interpolation in every locale", () => {
    expect(mobileSettingsKeys.every((key) => INTERFACE_MESSAGE_KEYS.includes(key))).toBe(true);
    for (const language of ["en", "de", "fr"] as const) {
      expect(
        translateInterfaceMessage(language, "mobile.settings.version", { version: "1.2.3" }),
      ).toContain("1.2.3");
      expect(
        translateInterfaceMessage(language, "mobile.settings.update.failed", {
          message: "network",
        }),
      ).toContain("network");
      expect(
        translateInterfaceMessage(language, "mobile.settings.liveActivities.linkedCount", {
          count: 2,
        }),
      ).toContain("2");
      expect(
        translateInterfaceMessage(language, "mobile.agentActivity.activeAgents", { count: 2 }),
      ).toContain("2");
    }
  });

  it("ships typed Better T3 selector values and plural summaries", () => {
    expect(betterT3ValueKeys.every((key) => INTERFACE_MESSAGE_KEYS.includes(key))).toBe(true);
    expect(betterT3PreviewKeys.every((key) => INTERFACE_MESSAGE_KEYS.includes(key))).toBe(true);
    for (const language of ["en", "de", "fr"] as const) {
      expect(
        translateInterfaceMessage(language, "settings.betterT3.value.days", { count: 2 }),
      ).toContain("2");
      expect(
        translateInterfaceMessage(language, "settings.betterT3.value.projectCount", { count: 2 }),
      ).toContain("2");
    }
  });

  it("explains the outcome of visualized Better T3 settings in every language", () => {
    const descriptionKeys = [
      "betterT3.agent.planMode.description",
      "betterT3.agent.generalSubagents.description",
      "betterT3.agent.reasoningVisibility.description",
      "betterT3.chat.sidebarPosition.description",
      "betterT3.chat.presentation.description",
      "betterT3.chat.workspaceCardDeck.description",
    ] as const satisfies readonly InterfaceMessageKey[];

    for (const language of ["en", "de", "fr"] as const) {
      for (const key of descriptionKeys) {
        const description = translateInterfaceMessage(language, key);
        expect(description.split(/\s+/).length, `${language}:${key}`).toBeGreaterThanOrEqual(8);
        expect(description, `${language}:${key}`).not.toMatch(
          /^(Enable or disable|Choose the setting|.+ ein- oder ausschalten|Die Einstellung für|Activer ou désactiver|Choisir le réglage)/,
        );
      }
    }
  });

  it("honors an explicit language independently of the host locale", () => {
    expect(resolveInterfaceLocale("en", ["de-DE"])).toEqual({
      language: "en",
      locale: "en-US",
    });
    expect(resolveInterfaceLocale("de", ["en-GB"])).toEqual({
      language: "de",
      locale: "de-DE",
    });
    expect(resolveInterfaceLocale("fr", ["de-CH"])).toEqual({
      language: "fr",
      locale: "fr-FR",
    });
  });

  it("negotiates supported system locales in preference order", () => {
    expect(resolveInterfaceLocale("system", ["fr-FR", "de-AT", "en-GB"])).toEqual({
      language: "fr",
      locale: "fr-FR",
    });
    expect(resolveInterfaceLocale("system", ["en_GB"])).toEqual({
      language: "en",
      locale: "en-GB",
    });
    expect(resolveInterfaceLocale("system", ["de_CH"])).toEqual({
      language: "de",
      locale: "de-CH",
    });
    expect(resolveInterfaceLocale("system", ["fr_CA"])).toEqual({
      language: "fr",
      locale: "fr-FR",
    });
  });

  it.each(["de-DE", "de-AT", "de-CH", "fr-FR"] as const)(
    "preserves the supported %s formatting locale",
    (locale) => {
      const resolved = resolveInterfaceLocale("system", [locale]);
      const translator = createInterfaceTranslator(resolved);

      expect(resolved.locale).toBe(locale);
      expect(translator.number(12_345.5)).toBe(new Intl.NumberFormat(locale).format(12_345.5));
    },
  );

  it("falls back to English for missing, invalid, or unsupported locales", () => {
    expect(resolveInterfaceLocale("system", [])).toEqual({
      language: "en",
      locale: "en-US",
    });
    expect(resolveInterfaceLocale("system", ["not a locale", "es-ES"])).toEqual({
      language: "en",
      locale: "en-US",
    });
    expect(resolveInterfaceLocale("system", ["not a locale", "fr-FR"])).toEqual({
      language: "fr",
      locale: "fr-FR",
    });
  });

  it("translates every resource-protection state in English, German, and French", () => {
    expect(translateInterfaceMessage("en", "resourceProtection.throttled.label")).toBe(
      "Provider temporarily throttled",
    );
    expect(translateInterfaceMessage("de", "resourceProtection.throttled.label")).toBe(
      "Provider vorübergehend gedrosselt",
    );
    expect(translateInterfaceMessage("fr", "resourceProtection.throttled.label")).toBe(
      "Fournisseur temporairement limité",
    );
    expect(translateInterfaceMessage("en", "resourceProtection.waiting.description")).toContain(
      "automatically",
    );
    expect(translateInterfaceMessage("de", "resourceProtection.waiting.description")).toContain(
      "automatisch",
    );
    expect(translateInterfaceMessage("fr", "resourceProtection.waiting.description")).toContain(
      "automatiquement",
    );
  });

  it("formats plural, list, number, and date values with the resolved locale", () => {
    const swissGerman = createInterfaceTranslator({ language: "de", locale: "de-CH" });
    const french = createInterfaceTranslator({ language: "fr", locale: "fr-FR" });

    expect(swissGerman.message("knowledgeGraph.resultCount", { count: 1 })).toBe("1 Ergebnis");
    expect(swissGerman.message("knowledgeGraph.resultCount", { count: 2 })).toBe("2 Ergebnisse");
    expect(french.message("knowledgeGraph.resultCount", { count: 2 })).toBe("2 résultats");
    expect(french.message("knowledgeGraph.indexedFileCount", { count: 2 })).toContain("2");
    expect(swissGerman.message("knowledgeGraph.nodeCount", { count: 2 })).toContain("2");
    expect(swissGerman.number(12_345.5)).toBe(new Intl.NumberFormat("de-CH").format(12_345.5));
    expect(french.list(["Alpha", "Beta"])).toBe(
      new Intl.ListFormat("fr-FR", { style: "long", type: "conjunction" }).format([
        "Alpha",
        "Beta",
      ]),
    );
    const instant = DateTime.toDate(DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"));
    expect(french.date(instant, { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(instant),
    );
  });

  it("localizes Knowledge Graph provenance and confidence formatting", () => {
    const german = createInterfaceTranslator({ language: "de", locale: "de-DE" });
    const french = createInterfaceTranslator({ language: "fr", locale: "fr-FR" });

    expect(german.message("knowledgeGraph.provenance.deterministic" as InterfaceMessageKey)).toBe(
      "Deterministisch",
    );
    expect(french.message("knowledgeGraph.provenance.semantic" as InterfaceMessageKey)).toBe(
      "Sémantique",
    );
    expect(german.number(0.875, { style: "percent", maximumFractionDigits: 0 })).toBe(
      new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 0 }).format(0.875),
    );
  });

  it("keeps interpolated user and repository content byte-for-byte while pseudo-localizing copy", () => {
    const repositoryValue = "src/Überblick.ts: prompt {{do not translate}}";
    const translated = pseudoLocalizeInterfaceMessage("knowledgeGraph.sourceSummary", {
      source: repositoryValue,
    });

    expect(translated).toContain(repositoryValue);
    expect(translated).not.toBe(`Source: ${repositoryValue}`);
    expect(pseudoLocalizeInterfaceMessage("chat.empty.startConversation")).toMatch(/^⟦.+⟧$/);
  });
});
