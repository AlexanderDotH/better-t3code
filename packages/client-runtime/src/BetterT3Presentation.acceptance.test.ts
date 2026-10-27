import {
  CHAT_VISUAL_MODES,
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  ServerSettingsPatch,
  chatVisualModeToLegacyRecord,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { resolveChatPresentation } from "./chatPresentation.ts";
import { chatVisualModeSyncWritePatch, planChatVisualModeSync } from "./chatVisualModeSync.ts";
import { mergeClientSettingsPatch } from "./clientSettings.ts";

const decodeSavedSettings = Schema.decodeUnknownSync(Schema.fromJsonString(ClientSettingsSchema));
const decodeServerPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

describe("Better T3 presentation acceptance", () => {
  it.each(CHAT_VISUAL_MODES)(
    "carries %s through local persistence and remote synchronization with independent controls intact",
    (mode) => {
      const initialSettings = mergeClientSettingsPatch(DEFAULT_CLIENT_SETTINGS, {
        fontSizeInterface: 17,
        showReasoning: false,
        betterT3Device: {
          flags: {
            "chat.workspaceCardDeck": false,
            "chat.cardMorphing": false,
            "chat.characterStreamingMotion": false,
            "chat.presentationMotion": false,
            "agent.reasoningVisibility": false,
            "agent.reasoningWorkingOverlay": false,
          },
        },
      });
      const selectedRecord = { mode, updatedAt: 2_000, updateId: `desktop:${mode}` };
      const localSettings = mergeClientSettingsPatch(initialSettings, {
        chatVisualModeLocalRecord: chatVisualModeToLegacyRecord(selectedRecord),
        chatVisualModeLocalRecordV2: selectedRecord,
      });
      const persistedSettings = decodeSavedSettings(JSON.stringify(localSettings));
      const outbound = planChatVisualModeSync({
        localRecord: persistedSettings.chatVisualModeLocalRecord,
        localRecordV2: persistedSettings.chatVisualModeLocalRecordV2,
        environments: [
          {
            environmentId: "remote",
            environmentSettingsVersion: 6,
            connected: true,
            record: null,
            recordV2: null,
          },
        ],
      });

      expect(outbound.writes).toHaveLength(1);
      const wirePatch = decodeServerPatch(chatVisualModeSyncWritePatch(outbound.writes[0]!));
      const inbound = planChatVisualModeSync({
        localRecord: null,
        localRecordV2: null,
        environments: [
          {
            environmentId: "remote",
            environmentSettingsVersion: 6,
            connected: true,
            record: chatVisualModeToLegacyRecord(selectedRecord),
            recordV2: wirePatch.chatVisualModeSyncRecordV2 ?? null,
          },
        ],
      });

      expect(inbound.winner).toEqual(selectedRecord);
      expect(inbound.writes).toEqual([]);
      expect(persistedSettings.betterT3Device).toEqual(initialSettings.betterT3Device);
      expect(persistedSettings.fontSizeInterface).toBe(17);
      expect(persistedSettings.showReasoning).toBe(false);

      for (const reducedMotion of [false, true]) {
        expect(
          resolveChatPresentation({
            mode: inbound.winner!.mode,
            presentationMotion: persistedSettings.betterT3Device.flags["chat.presentationMotion"]!,
            characterStreamingMotion:
              persistedSettings.betterT3Device.flags["chat.characterStreamingMotion"]!,
            reducedMotion,
          }),
        ).toEqual({
          mode,
          variant: mode,
          grouping: mode,
          presentationMotion: false,
          characterStreamingMotion: false,
        });
      }
    },
  );

  it("keeps the selected mode during a motion change without creating synchronization writes", () => {
    const selectedRecord = {
      mode: "better-t3" as const,
      updatedAt: 3_000,
      updateId: "mobile:offline-selection",
    };
    const savedSettings = mergeClientSettingsPatch(DEFAULT_CLIENT_SETTINGS, {
      chatVisualModeLocalRecord: chatVisualModeToLegacyRecord(selectedRecord),
      chatVisualModeLocalRecordV2: selectedRecord,
      betterT3Device: {
        flags: { "chat.presentationMotion": true, "chat.characterStreamingMotion": true },
      },
    });
    const updatedSettings = mergeClientSettingsPatch(savedSettings, {
      betterT3Device: { flags: { "chat.presentationMotion": false } },
    });
    const plan = planChatVisualModeSync({
      localRecord: updatedSettings.chatVisualModeLocalRecord,
      localRecordV2: updatedSettings.chatVisualModeLocalRecordV2,
      environments: [
        {
          environmentId: "old-server",
          environmentSettingsVersion: 3,
          connected: true,
          record: { mode: "classic", updatedAt: 1_000, updateId: "older" },
        },
      ],
    });

    expect(plan.winner).toEqual(selectedRecord);
    expect(plan.writes).toEqual([]);
    expect(plan.unsupportedEnvironmentIds).toEqual(["old-server"]);
    expect(updatedSettings.chatVisualModeLocalRecordV2).toBe(
      savedSettings.chatVisualModeLocalRecordV2,
    );
    expect(updatedSettings.betterT3Device.flags["chat.characterStreamingMotion"]).toBe(true);
    expect(
      resolveChatPresentation({
        mode: plan.winner!.mode,
        presentationMotion: updatedSettings.betterT3Device.flags["chat.presentationMotion"]!,
        characterStreamingMotion:
          updatedSettings.betterT3Device.flags["chat.characterStreamingMotion"]!,
        reducedMotion: false,
      }),
    ).toEqual({
      mode: "better-t3",
      variant: "better-t3",
      grouping: "better-t3",
      presentationMotion: false,
      characterStreamingMotion: true,
    });
  });
});
