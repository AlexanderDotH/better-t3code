import {
  InterfaceLocaleSyncRecordV1,
  type InterfaceLanguageSyncRecord,
  type InterfaceLocalePreferenceV1,
  type InterfaceLocaleSyncRecordV1 as InterfaceLocaleSyncRecordV1Type,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { Preferences } from "../persistence/mobile-preferences";

const decodeInterfaceLocaleSyncRecordV1 = Schema.decodeUnknownSync(InterfaceLocaleSyncRecordV1);

export interface MobileInterfaceLocalePreferencePatch extends Pick<
  Preferences,
  "interfaceLocaleSyncRecordV1"
> {
  readonly interfaceLocaleSyncRecordV1: InterfaceLocaleSyncRecordV1Type;
  readonly interfaceLanguageSyncRecord?: InterfaceLanguageSyncRecord;
}

export function resolveMobileInterfaceLocalePreference(
  record: InterfaceLocaleSyncRecordV1Type | undefined,
): InterfaceLocalePreferenceV1 {
  return record?.preference ?? "system";
}

export function createMobileInterfaceLocaleRecordV1(
  preference: InterfaceLocalePreferenceV1,
  updatedAt: number,
  updateId: string,
): InterfaceLocaleSyncRecordV1Type {
  return decodeInterfaceLocaleSyncRecordV1({ version: 1, preference, updatedAt, updateId });
}

export function mobileInterfaceLocalePreferencePatch(
  record: InterfaceLocaleSyncRecordV1Type,
  legacyMirror?: InterfaceLanguageSyncRecord,
): MobileInterfaceLocalePreferencePatch {
  return {
    interfaceLocaleSyncRecordV1: record,
    ...(legacyMirror === undefined ? {} : { interfaceLanguageSyncRecord: legacyMirror }),
  };
}

export function nextMobileInterfaceLanguageUpdatedAt(input: {
  readonly now: number;
  readonly winnerUpdatedAt: number | undefined;
  readonly previousLocalUpdatedAt: number;
}): number {
  return Math.max(input.now, (input.winnerUpdatedAt ?? -1) + 1, input.previousLocalUpdatedAt + 1);
}
