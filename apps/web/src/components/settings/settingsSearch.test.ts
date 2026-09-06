import { describe, expect, it } from "vite-plus/test";
import { translateInterfaceMessage } from "@t3tools/shared/interfaceLanguage";

import {
  searchableSetting,
  localizeSettingsSearchItems,
  resolveSettingsSectionLabels,
  searchSettings,
  SETTINGS_SECTION_LABELS,
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchItem,
} from "./settingsSearch";

const ITEMS: ReadonlyArray<SettingsSearchItem> = [
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/general",
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/connections",
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
  },
  {
    id: "provider-updates",
    title: "Update checks",
    to: "/settings/general",
  },
  {
    id: "automatic-updates",
    title: "Automatic updates",
    to: "/settings/general",
  },
];

describe("searchSettings", () => {
  it("localizes built-in navigation, anchors, and searchable titles from typed message ids", () => {
    const german = (key: Parameters<typeof translateInterfaceMessage>[1]) =>
      translateInterfaceMessage("de", key);
    const french = (key: Parameters<typeof translateInterfaceMessage>[1]) =>
      translateInterfaceMessage("fr", key);

    expect(resolveSettingsSectionLabels(german)["/settings/general"]).toBe("Allgemein");
    expect(searchableSetting("word-wrap", german)).toEqual({
      id: "word-wrap",
      title: "Zeilenumbruch",
    });
    expect(
      searchSettings("graphe de connaissances", localizeSettingsSearchItems(french)).map(
        (item) => item.id,
      ),
    ).toEqual(["better-t3-knowledge-graph"]);
  });

  it("matches only setting titles", () => {
    expect(searchSettings("word", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("network", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("connections", ITEMS)).toEqual([]);
    expect(searchSettings("claude", ITEMS)).toEqual([]);
  });

  it("matches normalized title substrings", () => {
    expect(searchSettings("  WORD   WRAP  ", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("glass").map((item) => item.id)).toEqual(["setting-glass-opacity"]);
    expect(searchSettings("xyzzy")).toEqual([]);
  });

  it("keeps catalog order for multiple title matches", () => {
    expect(searchSettings("update", ITEMS).map((item) => item.id)).toEqual([
      "provider-updates",
      "automatic-updates",
    ]);
  });

  it("lists thread confirmations in panel order", () => {
    expect(searchSettings("confirmation").map((item) => item.id)).toEqual([
      "unpin-confirmation",
      "archive-confirmation",
      "delete-confirmation",
    ]);
  });

  it("returns no results for an empty query", () => {
    expect(searchSettings("   ", ITEMS)).toEqual([]);
  });

  it("hides desktop-only settings from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "quit-confirmation")).toBe(true);
    expect(searchSettings("quit confirmation")).toEqual([]);
  });

  it("hides macOS window transparency from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "macos-window-transparency")).toBe(
      true,
    );
    expect(searchSettings("Background transparency and blur")).toEqual([]);
  });

  it("keeps catalog result ids unique", () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("serves anchor props to panels from the catalog", () => {
    expect(searchableSetting("word-wrap")).toEqual({ id: "word-wrap", title: "Word wrap" });
    expect(searchableSetting("archive")).toEqual({ id: "archive", title: "Archived threads" });
  });

  it("routes appearance settings to their current section", () => {
    expect(searchSettings("theme")[0]).toMatchObject({
      id: "theme",
      to: "/settings/appearance",
    });
    expect(searchSettings("word wrap")[0]).toMatchObject({
      id: "word-wrap",
      to: "/settings/appearance",
    });
    expect(searchSettings("model reasoning")[0]).toMatchObject({
      id: "model-reasoning",
      to: "/settings/appearance",
    });
    expect(searchSettings("chat visuals")[0]).toMatchObject({
      id: "chat-visuals",
      to: "/settings/appearance",
    });
    expect(searchSettings("expanded chat controls")[0]).toMatchObject({
      id: "expanded-chat-controls",
      to: "/settings/appearance",
    });
    expect(searchSettings("environment identification")[0]).toMatchObject({
      id: "environment-identification",
      to: "/settings/appearance",
      targetId: "appearance",
    });
  });

  it("routes Sidebar layout to its stable Appearance control", () => {
    expect(searchSettings("sidebar layout")).toEqual([
      {
        id: "sidebar-layout",
        title: "Sidebar layout",
        to: "/settings/appearance",
      },
    ]);
    expect(searchableSetting("sidebar-layout")).toEqual({
      id: "sidebar-layout",
      title: "Sidebar layout",
    });
  });

  it("routes chats-per-project searches to Appearance", () => {
    expect(searchSettings("chats per project")).toEqual([
      {
        id: "chats-per-project",
        title: "Chats per project",
        to: "/settings/appearance",
      },
    ]);
    expect(searchableSetting("chats-per-project")).toEqual({
      id: "chats-per-project",
      title: "Chats per project",
    });
  });

  it("routes checkpoint searches to project settings", () => {
    expect(searchSettings("checkpoints")).toEqual([
      {
        id: "checkpoints",
        title: "Checkpoints",
        to: "/settings/projects",
      },
    ]);
  });

  it("routes harness chat sync searches to project settings", () => {
    expect(searchSettings("harness chat sync")).toEqual([
      {
        id: "harness-chat-sync",
        title: "Harness chat sync",
        to: "/settings/projects",
      },
    ]);
  });

  it("keeps Skills, MCP, and browser integrations as separate destinations", () => {
    expect(SETTINGS_SECTION_LABELS["/settings/skills"]).toBe("Skills");
    expect(SETTINGS_SECTION_LABELS["/settings/mcp"]).toBe("MCP Servers");
    expect(SETTINGS_SECTION_LABELS["/settings/integrations"]).toBe("Integrations");

    expect(searchSettings("skills")[0]).toMatchObject({ to: "/settings/skills" });
    expect(searchSettings("MCP servers")[0]).toMatchObject({ to: "/settings/mcp" });
    expect(searchSettings("agent browser access")[0]).toMatchObject({
      to: "/settings/integrations",
      targetId: "browser",
    });
  });

  it("routes Better T3 feature controls to their dedicated settings page", () => {
    expect(SETTINGS_SECTION_LABELS["/settings/better-t3"]).toBe("Better T3");
    expect(searchSettings("Better T3")).toContainEqual({
      id: "better-t3",
      title: "Better T3",
      to: "/settings/better-t3",
    });
    expect(searchSettings("Knowledge Graph")).toContainEqual({
      id: "better-t3-knowledge-graph",
      title: "Knowledge Graph",
      to: "/settings/better-t3",
      targetId: "knowledge.graph",
    });
  });
});
