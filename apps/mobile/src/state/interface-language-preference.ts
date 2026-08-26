import {
  DEFAULT_INTERFACE_LANGUAGE_PREFERENCE,
  InterfaceLanguageSyncRecord,
  type InterfaceLanguagePreference,
  type InterfaceLanguageSyncRecord as InterfaceLanguageSyncRecordType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { Preferences } from "../persistence/mobile-preferences";

const decodeInterfaceLanguageSyncRecord = Schema.decodeUnknownSync(InterfaceLanguageSyncRecord);

export interface MobileInterfaceLanguagePreferencePatch extends Pick<
  Preferences,
  "interfaceLanguageSyncRecord"
> {
  readonly interfaceLanguageSyncRecord: InterfaceLanguageSyncRecordType;
}

export function resolveMobileInterfaceLanguagePreference(
  record: InterfaceLanguageSyncRecordType | undefined,
): InterfaceLanguagePreference {
  return record?.preference ?? DEFAULT_INTERFACE_LANGUAGE_PREFERENCE;
}

export function createMobileInterfaceLanguageRecord(
  preference: InterfaceLanguagePreference,
  updatedAt: number,
  updateId: string,
): InterfaceLanguageSyncRecordType {
  return decodeInterfaceLanguageSyncRecord({ preference, updatedAt, updateId });
}

export function mobileInterfaceLanguagePreferencePatch(
  record: InterfaceLanguageSyncRecordType,
): MobileInterfaceLanguagePreferencePatch {
  return { interfaceLanguageSyncRecord: record };
}

export function nextMobileInterfaceLanguageUpdatedAt(input: {
  readonly now: number;
  readonly winnerUpdatedAt: number | undefined;
  readonly previousLocalUpdatedAt: number;
}): number {
  return Math.max(input.now, (input.winnerUpdatedAt ?? -1) + 1, input.previousLocalUpdatedAt + 1);
}
