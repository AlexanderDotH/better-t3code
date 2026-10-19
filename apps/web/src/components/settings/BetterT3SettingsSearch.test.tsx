// @vitest-environment jsdom
import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { expect, it } from "vite-plus/test";

import {
  buildBetterT3FeatureSearchItems,
  readBetterT3SettingsSearchItems,
} from "./BetterT3SettingsSearch";
import { buildBetterT3ControlStates } from "./BetterT3SettingsPanel.logic";
import { searchSettings } from "./settingsSearch";

it("finds mounted translated settings by label, category and aliases, and refreshes changed content", () => {
  const page = document.createElement("div");
  page.innerHTML = `
    <div role="region" id="better-t3-group-chat" tabindex="-1">
      <h2>Chat</h2>
      <section>
        <h2 class="sr-only">Chat</h2>
        <div data-slot="settings-row" id="agent.reasoningVisibility" tabindex="-1">
          <div><div><h3>Darstellung der Thinking-Traces</h3><p>Live-Gedanken verfolgen</p></div></div>
        </div>
      </section>
      <div hidden>
        <div data-slot="settings-row" id="hidden" tabindex="-1"><h3>Hidden option</h3></div>
      </div>
    </div>
    <div role="region" id="better-t3-group-voice" tabindex="-1">
      <h2>Spracheingabe</h2>
      <section id="voice.credentials" tabindex="-1"><h2>AssemblyAI-Zugang</h2></section>
    </div>
  `;
  const items = readBetterT3SettingsSearchItems(page);
  expect(items.find((item) => item.targetId === "agent.reasoningVisibility")).toMatchObject({
    category: "Chat",
    description: "Live-Gedanken verfolgen",
    title: "Darstellung der Thinking-Traces",
  });
  for (const query of [
    "Thinking-Traces",
    "Chat Gedanken",
    "reasoning visibility",
    "Working dialog",
  ]) {
    expect(searchSettings(query, items)[0]).toMatchObject({
      title: "Darstellung der Thinking-Traces",
      to: "/settings/better-t3",
      targetId: "agent.reasoningVisibility",
    });
  }
  expect(searchSettings("Spracheingabe Zugang", items)[0]?.targetId).toBe("voice.credentials");
  expect(searchSettings("Hidden", items)).toEqual([]);
  page.querySelector('[id="voice.credentials"]')!.remove();
  expect(searchSettings("AssemblyAI-Zugang", readBetterT3SettingsSearchItems(page))).toEqual([]);
});

it("finds declared lazy fields by translated text and remembered aliases without revealing hidden controls", () => {
  const translate = createInterfaceTranslator({ language: "de", locale: "de-DE" }).message;
  const controls = buildBetterT3ControlStates({
    registry: BETTER_T3_FEATURE_REGISTRY,
    device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    surface: "web",
    capabilities: {},
    environmentAvailable: false,
  });
  const visibleControls = controls.filter(({ descriptor }) =>
    ["agent.fetchModel", "agent.reasoningVisibility"].includes(descriptor.id),
  );
  const declared = buildBetterT3FeatureSearchItems(visibleControls, translate);
  const page = document.createElement("div");
  page.innerHTML = `
    <div hidden><div data-slot="settings-row" id="secret-option" tabindex="-1"><h3>Private option</h3></div></div>
  `;
  const items = readBetterT3SettingsSearchItems(page, declared);

  expect(searchSettings(translate("betterT3.agent.fetchModel.label"), items)[0]?.targetId).toBe(
    "agent.fetchModel",
  );
  expect(searchSettings("Working dialog", items)[0]).toMatchObject({
    title: translate("betterT3.agent.reasoningVisibility.label"),
    targetId: "agent.reasoningVisibility",
  });
  expect(searchSettings("Private option", items)).toEqual([]);
  expect(items.some((item) => item.targetId === "agent.contextCompactionModel")).toBe(false);
});

it("drops metadata when the current surface no longer renders its controls", () => {
  const translate = createInterfaceTranslator({ language: "fr", locale: "fr-FR" }).message;
  const page = document.createElement("div");
  const controls = buildBetterT3ControlStates({
    registry: BETTER_T3_FEATURE_REGISTRY,
    device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    surface: "web",
    capabilities: {},
  });
  const feature = controls.filter(({ descriptor }) => descriptor.id === "agent.fetchModel");
  const label = translate("betterT3.agent.fetchModel.label");
  expect(
    searchSettings(
      label,
      readBetterT3SettingsSearchItems(page, buildBetterT3FeatureSearchItems(feature, translate)),
    ),
  ).toHaveLength(1);
  expect(searchSettings(label, readBetterT3SettingsSearchItems(page, []))).toEqual([]);
});
