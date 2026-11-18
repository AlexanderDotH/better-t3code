import { describe, expect, it } from "vite-plus/test";

import { filterSettingsSections } from "./settings-search";

const SECTIONS = [
  { rows: [{ id: "SettingsUsage", label: "Usage" }] },
  {
    title: "Connections",
    rows: [
      { id: "account", label: "T3 Account" },
      { id: "SettingsEnvironments", label: "Environments" },
    ],
  },
  {
    title: "Interface",
    rows: [
      { id: "SettingsAppearance", label: "Appearance" },
      { id: "SettingsKeyboard", label: "Keyboard" },
    ],
  },
  {
    title: "Server settings",
    rows: [
      { id: "SettingsProviderAccounts", label: "Provider accounts" },
      { id: "SettingsEnvironmentSourceControl", label: "Source control" },
    ],
  },
];

function visible(query: string) {
  return filterSettingsSections(SECTIONS, query).map((section) => [
    section.title ?? null,
    section.rows.map((row) => row.label),
  ]);
}

describe("filterSettingsSections", () => {
  it.each([
    {
      query: "",
      expected: SECTIONS.map((section) => [
        section.title ?? null,
        section.rows.map((row) => row.label),
      ]),
    },
    { query: "   ", expected: visible("") },
    { query: "appear", expected: [["Interface", ["Appearance"]]] },
    { query: "KEYBOARD", expected: [["Interface", ["Keyboard"]]] },
    { query: "dark mode", expected: [["Interface", ["Appearance"]]] },
    { query: "agent credits", expected: [["Server settings", ["Source control"]]] },
    { query: "review guides", expected: [["Server settings", ["Source control"]]] },
    {
      query: "server settings",
      expected: [["Server settings", ["Provider accounts", "Source control"]]],
    },
    {
      query: "accounts",
      expected: [["Server settings", ["Provider accounts"]]],
    },
    {
      query: "usage",
      expected: [
        [null, ["Usage"]],
        ["Connections", ["Environments"]],
      ],
    },
    { query: "zzzz", expected: [] },
  ])("$query", ({ query, expected }) => {
    expect(visible(query)).toEqual(expected);
  });

  it("drops sections that start empty", () => {
    expect(filterSettingsSections([{ rows: [] }, ...SECTIONS], "").length).toBe(SECTIONS.length);
  });

  it("finds Better T3 controls inside category rows", () => {
    const composer = {
      id: "SettingsBetterT3Category:composer",
      label: "Composer",
      searchTerms: ["Context usage indicator", "Kontextnutzung", "Indicateur de contexte"],
    };
    const chat = {
      id: "SettingsBetterT3Category:chat",
      label: "Chat",
      searchTerms: ["Thinking trace display"],
    };
    const sections = [{ title: "Better T3", rows: [composer, chat] }];
    for (const query of ["context usage", "Kontextnutzung", "Indicateur de contexte"]) {
      expect(filterSettingsSections(sections, query)).toEqual([
        { title: "Better T3", rows: [composer] },
      ]);
    }
    expect(filterSettingsSections(sections, "thinking trace")).toEqual([
      { title: "Better T3", rows: [chat] },
    ]);
  });
});

it.each([
  ["snooze presets", "SettingsThreads"],
  ["settled worktrees", "SettingsWorktrees"],
  ["host power monitor", "SettingsEnvironmentMaintenance"],
  ["signature header", "SettingsScheduledTasks"],
  ["destination thread", "SettingsScheduledTasks"],
  ["webhook deliveries", "SettingsScheduledTasks"],
  ["identity file", "SettingsDevices"],
  ["lease minutes", "SettingsDevices"],
  ["monogram", "SettingsProjectOverview"],
  ["run on settle", "SettingsProjectScripts"],
  ["merge method", "SettingsEnvironmentSourceControl"],
  ["guest sharing", "SettingsLabs"],
])("finds %s on its settings page", (query, id) => {
  expect(filterSettingsSections([{ rows: [{ id, label: id }] }], query)).toHaveLength(1);
});
