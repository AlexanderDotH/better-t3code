import {
  ChatVisualModeSyncRecordV2,
  chatVisualModeToLegacyRecord,
  DEFAULT_CHAT_VISUAL_MODE,
  type ChatVisualMode,
  type ChatVisualModeSyncRecordV2 as ChatVisualModeSyncRecordType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { Preferences } from "../persistence/mobile-preferences";

const decodeChatVisualModeSyncRecord = Schema.decodeUnknownSync(ChatVisualModeSyncRecordV2);

export interface MobileChatVisualModePreferencePatch extends Pick<
  Preferences,
  "chatVisualModeSyncRecord" | "chatVisualModeSyncRecordV2"
> {
  readonly chatVisualModeSyncRecordV2: ChatVisualModeSyncRecordType;
}

export function resolveMobileChatVisualMode(
  record: ChatVisualModeSyncRecordType | undefined,
): ChatVisualMode {
  return record?.mode ?? DEFAULT_CHAT_VISUAL_MODE;
}

export function createMobileChatVisualModeRecord(
  mode: ChatVisualMode,
  updatedAt: number,
  updateId: string,
): ChatVisualModeSyncRecordType {
  return decodeChatVisualModeSyncRecord({ mode, updatedAt, updateId });
}

export function mobileChatVisualModePreferencePatch(
  record: ChatVisualModeSyncRecordType,
): MobileChatVisualModePreferencePatch {
  return {
    chatVisualModeSyncRecord: chatVisualModeToLegacyRecord(record),
    chatVisualModeSyncRecordV2: record,
  };
}

export function nextMobileChatVisualModeUpdatedAt(input: {
  readonly now: number;
  readonly winnerUpdatedAt: number | undefined;
  readonly previousLocalUpdatedAt: number;
}): number {
  return Math.max(input.now, (input.winnerUpdatedAt ?? -1) + 1, input.previousLocalUpdatedAt + 1);
}
