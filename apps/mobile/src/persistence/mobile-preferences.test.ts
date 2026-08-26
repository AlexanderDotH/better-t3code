import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import { sanitizeMobilePreferences } from "./mobile-preferences";

describe("sanitizeMobilePreferences", () => {
  it("deduplicates valid instance-scoped model favorites and drops malformed entries", () => {
    expect(
      sanitizeMobilePreferences({
        modelFavorites: [
          { provider: "openrouter", model: "openai/gpt-5.5" },
          { provider: "openrouter", model: "openai/gpt-5.5" },
          { provider: "openrouter_work", model: "anthropic/claude-sonnet" },
          { provider: "", model: "bad" },
          { provider: "openrouter", model: "" },
        ],
      }),
    ).toEqual({
      modelFavorites: [
        { provider: "openrouter", model: "openai/gpt-5.5" },
        { provider: "openrouter_work", model: "anthropic/claude-sonnet" },
      ],
    });
  });

  it("persists the device-local agent workflow preferences", () => {
    expect(
      sanitizeMobilePreferences({
        experimentalFetch: true,
        experimentalParallelPlanImplementation: true,
        improvePromptBeforeSend: true,
        voiceInputOutputLanguage: "english",
        olderProjectsExpanded: true,
      }),
    ).toEqual({
      experimentalFetch: true,
      experimentalParallelPlanImplementation: true,
      improvePromptBeforeSend: true,
      voiceInputOutputLanguage: "english",
      olderProjectsExpanded: true,
    });
  });

  it("drops malformed workflow preferences from untrusted storage", () => {
    expect(
      sanitizeMobilePreferences({
        experimentalFetch: "yes",
        experimentalParallelPlanImplementation: "yes",
        improvePromptBeforeSend: 1,
        voiceInputOutputLanguage: "german",
        olderProjectsExpanded: "yes",
      } as unknown as {
        experimentalFetch: boolean;
        experimentalParallelPlanImplementation: boolean;
        improvePromptBeforeSend: boolean;
        voiceInputOutputLanguage: "native" | "english";
        olderProjectsExpanded: boolean;
      }),
    ).toEqual({});
  });

  it("keeps a valid project thread preview sync record and migration marker", () => {
    expect(
      sanitizeMobilePreferences({
        projectThreadPreviewSyncRecord: {
          count: 6,
          updatedAt: 1_787_178_400_000,
          updateId: "mobile-device:preview-6",
        },
        projectThreadPreviewMigrationVersion: 1,
      }),
    ).toEqual({
      projectThreadPreviewSyncRecord: {
        count: 6,
        updatedAt: 1_787_178_400_000,
        updateId: "mobile-device:preview-6",
      },
      projectThreadPreviewMigrationVersion: 1,
    });
  });

  it.each([
    { count: 0, updatedAt: 1_787_178_400_000, updateId: "too-small" },
    { count: 16, updatedAt: 1_787_178_400_000, updateId: "too-large" },
    { count: 3, updatedAt: -1, updateId: "negative-time" },
    { count: 3, updatedAt: 1.5, updateId: "fractional-time" },
    { count: 3, updatedAt: 1_787_178_400_000, updateId: "   " },
  ])("drops an invalid cached project thread preview record: %o", (record) => {
    expect(
      sanitizeMobilePreferences({
        projectThreadPreviewSyncRecord: record,
        projectThreadPreviewMigrationVersion: 1,
      } as never),
    ).toEqual({ projectThreadPreviewMigrationVersion: 1 });
  });

  it("drops unsupported project thread preview migration markers", () => {
    expect(
      sanitizeMobilePreferences({
        projectThreadPreviewMigrationVersion: 2,
      } as never),
    ).toEqual({});
  });

  it("keeps a valid chat visual mode sync record", () => {
    expect(
      sanitizeMobilePreferences({
        chatVisualModeSyncRecord: {
          mode: "classic",
          updatedAt: 1_787_178_400_000,
          updateId: "mobile-device:chat-visuals-classic",
        },
      }),
    ).toEqual({
      chatVisualModeSyncRecord: {
        mode: "classic",
        updatedAt: 1_787_178_400_000,
        updateId: "mobile-device:chat-visuals-classic",
      },
    });
  });

  it.each([
    { mode: "legacy", updatedAt: 1_787_178_400_000, updateId: "invalid-mode" },
    { mode: "current", updatedAt: -1, updateId: "negative-time" },
    { mode: "classic", updatedAt: 1.5, updateId: "fractional-time" },
    { mode: "current", updatedAt: 1_787_178_400_000, updateId: "   " },
  ])("drops an invalid cached chat visual mode record: %o", (record) => {
    expect(
      sanitizeMobilePreferences({
        chatVisualModeSyncRecord: record,
      } as never),
    ).toEqual({});
  });

  it("keeps a valid interface language sync record", () => {
    expect(
      sanitizeMobilePreferences({
        interfaceLanguageSyncRecord: {
          preference: "de",
          updatedAt: 1_787_178_400_000,
          updateId: "mobile-device:language-de",
        },
      }),
    ).toEqual({
      interfaceLanguageSyncRecord: {
        preference: "de",
        updatedAt: 1_787_178_400_000,
        updateId: "mobile-device:language-de",
      },
    });
  });

  it.each([
    { preference: "fr", updatedAt: 1_787_178_400_000, updateId: "invalid-language" },
    { preference: "system", updatedAt: -1, updateId: "negative-time" },
    { preference: "de", updatedAt: 1.5, updateId: "fractional-time" },
    { preference: "en", updatedAt: 1_787_178_400_000, updateId: "   " },
  ])("drops an invalid cached interface language record: %o", (record) => {
    expect(
      sanitizeMobilePreferences({
        interfaceLanguageSyncRecord: record,
      } as never),
    ).toEqual({});
  });
});
