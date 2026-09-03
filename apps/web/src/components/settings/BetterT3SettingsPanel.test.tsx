import {
  BETTER_T3_FEATURE_REGISTRY,
  EnvironmentId,
  type BetterT3FeatureControlStateV1,
  type BetterT3FeatureId,
  type BetterT3FeatureSection,
} from "@t3tools/contracts";
import { prepareBetterT3StatusModel } from "@t3tools/client-runtime/better-t3-status";
import {
  createInterfaceTranslator,
  type InterfaceMessageKey,
} from "@t3tools/shared/interfaceLanguage";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  BETTER_T3_ADVANCED_FEATURE_IDS,
  BETTER_T3_SETTINGS_TABS,
  BetterT3SettingsIntroduction,
  BetterT3SettingsPanelView,
  resolveBetterT3ControlDestination,
  resolveBetterT3PreparedStatusMessageId,
  resolveBetterT3PreparedStatusText,
  resolveBetterT3SettingsSearchTarget,
  resolveWebBetterT3ControlRenderingPath,
} from "./BetterT3SettingsPanel";
import { SettingsSearchTargetProvider } from "./settingsLayout";

vi.mock("./settingsLayout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settingsLayout")>()),
  SettingsPageContainer: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));

const states: ReadonlyArray<BetterT3FeatureControlStateV1> = BETTER_T3_FEATURE_REGISTRY.map(
  (descriptor) => ({
    descriptor,
    availability: { state: "available" },
    value: descriptor.controlKind === "switch" ? false : null,
    source: "default",
  }),
);

const sectionTitles: Readonly<Record<BetterT3FeatureSection, string>> = {
  "agent-workflows": "Agent workflows",
  "chat-layout": "Chat and layout",
  "workspace-source-control": "Workspace and source control",
  "voice-synchronization": "Voice and synchronization",
  "knowledge-automation": "Knowledge and automation",
  "resource-protection": "Resource protection",
  "integration-status": "Integration status",
};

const renderWithSearchTarget = (targetId: string | null, panel: ReactNode): string =>
  renderToStaticMarkup(
    <SettingsSearchTargetProvider targetId={targetId}>{panel}</SettingsSearchTargetProvider>,
  );

describe("BetterT3SettingsPanelView", () => {
  it("renders eight accessible tabs with General selected by default", () => {
    const markup = renderToStaticMarkup(
      <BetterT3SettingsPanelView
        features={states}
        sectionTitles={sectionTitles}
        translate={(messageId) => messageId}
        controls={{}}
        languageControl={<div data-better-t3-language-control />}
        onSwitchChange={() => undefined}
      />,
    );

    expect(markup.match(/role="tablist"/g)).toHaveLength(1);
    expect(markup.match(/role="tab"/g)).toHaveLength(8);
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).toMatch(
      /role="tab"[^>]*aria-selected="true"[^>]*>settings\.betterT3\.tab\.general<\/button>/,
    );
    for (const tab of BETTER_T3_SETTINGS_TABS) expect(markup).toContain(tab.labelMessageId);
    expect(markup).toContain("data-better-t3-language-control");
    expect(markup).not.toContain("settings.betterT3.advancedSettings");
  });

  it("assigns every registry control to exactly one of the eight tabs", () => {
    const assignedFeatureIds = BETTER_T3_SETTINGS_TABS.flatMap((tab) =>
      tab.section === null
        ? []
        : BETTER_T3_FEATURE_REGISTRY.filter((descriptor) => descriptor.section === tab.section).map(
            (descriptor) => descriptor.id,
          ),
    );

    expect(BETTER_T3_SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      "general",
      "agents",
      "visual",
      "workspace",
      "voice",
      "knowledge",
      "system",
      "integrations",
    ]);
    expect(assignedFeatureIds).toHaveLength(BETTER_T3_FEATURE_REGISTRY.length);
    expect(new Set(assignedFeatureIds)).toEqual(
      new Set(BETTER_T3_FEATURE_REGISTRY.map((descriptor) => descriptor.id)),
    );
  });

  it("keeps the requested controls in Advanced settings and no others", () => {
    expect(BETTER_T3_ADVANCED_FEATURE_IDS).toEqual(
      new Set<BetterT3FeatureId>([
        "agent.fetchModel",
        "agent.parallelPlanReviewer",
        "agent.cavemanMode",
        "chat.cardMorphing",
        "chat.previewCount",
        "chat.sorting",
        "chat.settling",
        "chat.shiftClickShowLess",
        "workspace.checkpoints",
        "workspace.chatPortability",
        "voice.outputLanguage",
        "voice.transcriptPortability",
        "voice.credentials",
        "knowledge.model",
        "knowledge.progress",
        "knowledge.rebuild",
        "knowledge.pause",
        "knowledge.clear",
        "resource.diagnostics",
        "integration.mcp",
        "integration.skills",
      ]),
    );
  });

  it("routes Settings search to the owning tab and opens Advanced settings when needed", () => {
    expect(resolveBetterT3SettingsSearchTarget("knowledge.graph")).toEqual({
      tabId: "knowledge",
      advanced: false,
    });
    expect(resolveBetterT3SettingsSearchTarget("knowledge.model")).toEqual({
      tabId: "knowledge",
      advanced: true,
    });
    expect(resolveBetterT3SettingsSearchTarget("agent.autoReasoningModel")).toEqual({
      tabId: "agents",
      advanced: false,
    });
    expect(resolveBetterT3SettingsSearchTarget("better-t3-interface-language")).toEqual({
      tabId: "general",
      advanced: false,
    });

    for (const descriptor of BETTER_T3_FEATURE_REGISTRY) {
      const owningTab = BETTER_T3_SETTINGS_TABS.find((tab) => tab.section === descriptor.section);
      expect(resolveBetterT3SettingsSearchTarget(descriptor.id), descriptor.id).toEqual({
        tabId: owningTab?.id,
        advanced: BETTER_T3_ADVANCED_FEATURE_IDS.has(descriptor.id),
      });
    }
  });

  it("selects Knowledge for a Knowledge Graph search target", () => {
    const markup = renderToStaticMarkup(
      <SettingsSearchTargetProvider targetId="knowledge.graph">
        <BetterT3SettingsPanelView
          features={states}
          sectionTitles={sectionTitles}
          translate={(messageId) => messageId}
          controls={{}}
          onSwitchChange={() => undefined}
        />
      </SettingsSearchTargetProvider>,
    );

    expect(markup).toMatch(
      /role="tab"[^>]*aria-selected="true"[^>]*>settings\.betterT3\.tab\.knowledge<\/button>/,
    );
    expect(markup.match(/data-better-t3-feature="knowledge\.graph"/g)).toHaveLength(1);
    expect(markup).toContain("settings.betterT3.advancedSettings");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('data-better-t3-feature="knowledge.model"');
  });

  it("opens the owning tab and Advanced settings for an advanced search target", () => {
    const markup = renderToStaticMarkup(
      <SettingsSearchTargetProvider targetId="knowledge.model">
        <BetterT3SettingsPanelView
          features={states}
          sectionTitles={sectionTitles}
          translate={(messageId) => messageId}
          controls={{}}
          onSwitchChange={() => undefined}
        />
      </SettingsSearchTargetProvider>,
    );

    expect(markup).toMatch(
      /role="tab"[^>]*aria-selected="true"[^>]*>settings\.betterT3\.tab\.knowledge<\/button>/,
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup.match(/data-better-t3-feature="knowledge\.model"/g)).toHaveLength(1);
  });

  it("keeps a blocked stored switch visibly on but prevents activation changes", () => {
    const cardMorphing = states.find((entry) => entry.descriptor.id === "chat.cardMorphing")!;
    const markup = renderWithSearchTarget(
      "chat.cardMorphing",
      <BetterT3SettingsPanelView
        features={[
          {
            ...cardMorphing,
            value: true,
            availability: { state: "blocked", reasonMessageId: "dependency.disabled" },
          },
        ]}
        sectionTitles={sectionTitles}
        translate={(messageId) => messageId}
        controls={{}}
        onSwitchChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("settings.betterT3.availability.blocked");
    expect(markup).not.toContain("dependency.disabled");
  });

  it("uses translated labels for switch accessibility names", () => {
    const workspaceDeck = states.find((entry) => entry.descriptor.id === "chat.workspaceCardDeck")!;
    const markup = renderWithSearchTarget(
      "chat.workspaceCardDeck",
      <BetterT3SettingsPanelView
        features={[workspaceDeck]}
        sectionTitles={sectionTitles}
        translate={(messageId) =>
          messageId === workspaceDeck.descriptor.labelMessageId ? "Workspace-Karten" : messageId
        }
        controls={{}}
        onSwitchChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Workspace-Karten"');
    expect(markup).not.toContain(`aria-label="${workspaceDeck.descriptor.labelMessageId}"`);
  });

  it("does not forward an invalid descriptor message identifier to the translator", () => {
    const workspaceDeck = states.find((entry) => entry.descriptor.id === "chat.workspaceCardDeck")!;
    const invalidMessageId = "betterT3.chat.workspaceCardDeck.not-real";
    const translate = vi.fn((messageId: string) => messageId);

    const markup = renderWithSearchTarget(
      "chat.workspaceCardDeck",
      <BetterT3SettingsPanelView
        features={[
          {
            ...workspaceDeck,
            descriptor: {
              ...workspaceDeck.descriptor,
              labelMessageId: invalidMessageId,
            },
          },
        ]}
        sectionTitles={sectionTitles}
        translate={translate}
        controls={{}}
        onSwitchChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="betterT3.chat.workspaceCardDeck.label"');
    expect(translate).not.toHaveBeenCalledWith(invalidMessageId);
  });

  it("keeps long pseudo-localized labels inside the responsive settings grid", () => {
    const workspaceDeck = states.find((entry) => entry.descriptor.id === "chat.workspaceCardDeck")!;
    const longLabel = `⟦${"Fonction Better T3 très détaillée ".repeat(6).trim()}⟧`;
    const markup = renderWithSearchTarget(
      "chat.workspaceCardDeck",
      <BetterT3SettingsPanelView
        features={[workspaceDeck]}
        sectionTitles={sectionTitles}
        translate={(messageId) =>
          messageId === workspaceDeck.descriptor.labelMessageId ? longLabel : messageId
        }
        controls={{}}
        onSwitchChange={() => undefined}
      />,
    );

    expect(markup).toContain(longLabel);
    expect(markup).toContain("sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)]");
  });

  it("keeps each visual with the setting it explains in the active tab", () => {
    const agentFeature = states.find((entry) => entry.descriptor.id === "agent.planMode")!;
    const chatFeature = states.find((entry) => entry.descriptor.id === "chat.workspaceCardDeck")!;
    const panel = (
      <BetterT3SettingsPanelView
        features={[agentFeature, chatFeature]}
        sectionTitles={sectionTitles}
        translate={(messageId) => messageId}
        controls={{}}
        featureVisuals={{
          "agent.planMode": <div data-better-t3-agent-visual />,
          "chat.workspaceCardDeck": <div data-better-t3-chat-visual />,
        }}
        onSwitchChange={() => undefined}
      />
    );
    const agentMarkup = renderWithSearchTarget("agent.planMode", panel);
    const chatMarkup = renderWithSearchTarget("chat.workspaceCardDeck", panel);

    const agentControlIndex = agentMarkup.indexOf('data-better-t3-feature="agent.planMode"');
    const agentVisualIndex = agentMarkup.indexOf("data-better-t3-agent-visual");
    const chatControlIndex = chatMarkup.indexOf('data-better-t3-feature="chat.workspaceCardDeck"');
    const chatVisualIndex = chatMarkup.indexOf("data-better-t3-chat-visual");

    expect(agentControlIndex).toBeGreaterThan(-1);
    expect(agentVisualIndex).toBeGreaterThan(agentControlIndex);
    expect(agentMarkup).not.toContain("data-better-t3-chat-visual");
    expect(chatControlIndex).toBeGreaterThan(-1);
    expect(chatVisualIndex).toBeGreaterThan(chatControlIndex);
    expect(chatMarkup).not.toContain("data-better-t3-agent-visual");
  });

  it("places a visual choice below its title and omits the old switch", () => {
    const agentFeature = states.find((entry) => entry.descriptor.id === "agent.planMode")!;
    const markup = renderWithSearchTarget(
      "agent.planMode",
      <BetterT3SettingsPanelView
        features={[agentFeature]}
        sectionTitles={sectionTitles}
        translate={(messageId) => messageId}
        controls={{}}
        featureChoices={{
          "agent.planMode": <div data-plan-mode-choice role="radiogroup" />,
        }}
        onSwitchChange={() => undefined}
      />,
    );

    expect(markup.match(/data-better-t3-feature="agent\.planMode"/g)).toHaveLength(1);
    expect(markup.match(/data-plan-mode-choice/g)).toHaveLength(1);
    expect(markup.indexOf("betterT3.agent.planMode.label")).toBeLessThan(
      markup.indexOf("data-plan-mode-choice"),
    );
    expect(markup).not.toContain('role="switch"');
  });
});

describe("BetterT3SettingsIntroduction", () => {
  it("shows the selected environment and both migration-default sources", () => {
    const messages: Partial<Record<InterfaceMessageKey, string>> = {
      "settings.betterT3.title": "Better T3",
      "settings.betterT3.description": "Feature controls",
      "settings.betterT3.selectEnvironment": "Select environment",
      "settings.betterT3.deviceScope": "This device",
      "settings.betterT3.environmentScope": "Selected environment",
      "settings.betterT3.initialization.clean": "New defaults",
      "settings.betterT3.initialization.existing": "Existing behavior",
    };
    const markup = renderToStaticMarkup(
      <BetterT3SettingsIntroduction
        environmentOptions={[
          { environmentId: EnvironmentId.make("primary"), label: "Primary PC" },
          { environmentId: EnvironmentId.make("remote"), label: "Remote Mac" },
        ]}
        selectedEnvironmentId={EnvironmentId.make("remote")}
        deviceInitialization="clean-install"
        environmentInitialization="existing-install-migration"
        translate={(messageId) => messages[messageId] ?? messageId}
        onEnvironmentChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Select environment"');
    expect(markup).toContain("Remote Mac");
    expect(markup).toContain("This device: New defaults");
    expect(markup).toContain("Selected environment: Existing behavior");
  });
});

describe("resolveBetterT3ControlDestination", () => {
  it("deep-links credentials to the page that actually owns AssemblyAI settings", () => {
    expect(resolveBetterT3ControlDestination("voice.credentials")).toBe("/settings/connections");
  });

  it("deep-links portability controls to their real owners", () => {
    expect(resolveBetterT3ControlDestination("workspace.chatPortability")).toBe(
      "/settings/projects",
    );
    expect(resolveBetterT3ControlDestination("voice.transcriptPortability")).toBe(
      "/settings/projects",
    );
  });

  it("does not pretend Project Settings owns Knowledge Graph clearing", () => {
    expect(resolveBetterT3ControlDestination("knowledge.clear")).toBeNull();
    const clearDescriptor = BETTER_T3_FEATURE_REGISTRY.find(
      (descriptor) => descriptor.id === "knowledge.clear",
    );
    expect(clearDescriptor).toBeDefined();
    expect(resolveWebBetterT3ControlRenderingPath(clearDescriptor!)).toBe("prepared-control");
  });

  it("gives every Web and Desktop descriptor an effective rendering path", () => {
    for (const descriptor of BETTER_T3_FEATURE_REGISTRY) {
      if (
        !descriptor.availability.surfaces.includes("web") &&
        !descriptor.availability.surfaces.includes("desktop")
      ) {
        continue;
      }
      expect(resolveWebBetterT3ControlRenderingPath(descriptor), descriptor.id).not.toBe("missing");
    }
  });
});

describe("resolveBetterT3PreparedStatusMessageId", () => {
  it("never presents prepared integration states as generic availability", () => {
    expect(
      resolveBetterT3PreparedStatusMessageId({
        featureId: "integration.remoteReadiness",
        state: "ready",
      }),
    ).toBe("settings.betterT3.status.remoteReady");
    expect(
      resolveBetterT3PreparedStatusMessageId({
        featureId: "integration.lifecycleHealth",
        state: "unknown",
        connectionPhase: "reconnecting",
      }),
    ).toBe("settings.betterT3.status.lifecycleReconnecting");
    expect(
      resolveBetterT3PreparedStatusMessageId({
        featureId: "integration.compatibility",
        state: "degraded",
      }),
    ).toBe("settings.betterT3.status.compatibilityLimited");
    expect(
      resolveBetterT3PreparedStatusMessageId({
        featureId: "workspace.checkpoints",
        state: "project-required",
      }),
    ).toBe("settings.betterT3.status.projectRequired");
    expect(
      resolveBetterT3PreparedStatusMessageId({
        featureId: "integration.remoteReadiness",
        state: "degraded",
      }),
    ).toBe("settings.betterT3.status.remoteLimited");
  });

  it("formats real MCP, skill, and compatibility counts instead of generic support", () => {
    const statuses = prepareBetterT3StatusModel({
      surface: "web",
      connectionPhase: "connected",
      capabilities: {
        repositoryIdentity: true,
        midChatProviderSwitching: false,
        mcpWorkspaceVersion: 1,
        environmentSettingsVersion: 1,
      },
      lifecycleReceipt: "welcome",
      registry: [],
      mcp: { configuredCount: 3, runtimeServers: null },
      skills: {
        advertisedSkills: [
          { name: "solid", path: "/skills/solid", enabled: true },
          { name: "docs", path: "/skills/docs", enabled: false },
        ],
        loadedSkills: [
          {
            id: "solid",
            name: "solid",
            path: "/skills/solid",
            scope: "global",
            enabled: true,
            readOnly: false,
            providerSupport: [],
          },
        ],
      },
      project: null,
      knowledgeGraphStatus: null,
    });
    const translate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;

    expect(
      resolveBetterT3PreparedStatusText({
        featureId: "integration.mcp",
        statuses,
        connectionPhase: "connected",
        translate,
      }),
    ).toBe("Unknown · 3 configured");
    expect(
      resolveBetterT3PreparedStatusText({
        featureId: "integration.skills",
        statuses,
        connectionPhase: "connected",
        translate,
      }),
    ).toBe("2 advertised · 1 loaded");
    expect(
      resolveBetterT3PreparedStatusText({
        featureId: "integration.compatibility",
        statuses,
        connectionPhase: "connected",
        translate,
      }),
    ).toBe("Current capabilities · 0/0 supported");
  });
});
