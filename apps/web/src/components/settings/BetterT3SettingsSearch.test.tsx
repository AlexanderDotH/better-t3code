// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";

import { readBetterT3SettingsSearchItems } from "./BetterT3SettingsSearch";
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
