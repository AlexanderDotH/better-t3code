import {
  DEFAULT_PROJECT_THREAD_PREVIEW_COUNT,
  type ProjectThreadPreviewCount as ProjectThreadPreviewCountType,
  ProjectThreadPreviewSyncRecord,
  type ProjectThreadPreviewSyncRecord as ProjectThreadPreviewSyncRecordType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { Preferences } from "../persistence/mobile-preferences";

export const MOBILE_PROJECT_THREAD_PREVIEW_MIGRATION_VERSION = 1 as const;

const decodeProjectThreadPreviewSyncRecord = Schema.decodeUnknownSync(
  ProjectThreadPreviewSyncRecord,
);

export function resolveMobileProjectThreadPreviewCount(
  record: ProjectThreadPreviewSyncRecordType | undefined,
): ProjectThreadPreviewCountType {
  return record?.count ?? DEFAULT_PROJECT_THREAD_PREVIEW_COUNT;
}

export function createMobileProjectThreadPreviewRecord(
  count: number,
  updatedAt: number,
  updateId: string,
): ProjectThreadPreviewSyncRecordType {
  return decodeProjectThreadPreviewSyncRecord({
    count,
    updatedAt,
    updateId,
  });
}

export function mobileProjectThreadPreviewPreferencePatch(
  record: ProjectThreadPreviewSyncRecordType,
): Pick<Preferences, "projectThreadPreviewSyncRecord" | "projectThreadPreviewMigrationVersion"> {
  return {
    projectThreadPreviewSyncRecord: record,
    projectThreadPreviewMigrationVersion: MOBILE_PROJECT_THREAD_PREVIEW_MIGRATION_VERSION,
  };
}

export function initializeMobileProjectThreadPreviewPreference(input: {
  readonly localRecord: ProjectThreadPreviewSyncRecordType | undefined;
  readonly migrationVersion: Preferences["projectThreadPreviewMigrationVersion"];
  readonly remoteRecordExists: boolean;
}): Pick<
  Preferences,
  "projectThreadPreviewSyncRecord" | "projectThreadPreviewMigrationVersion"
> | null {
  if (
    input.localRecord !== undefined ||
    input.remoteRecordExists ||
    input.migrationVersion === MOBILE_PROJECT_THREAD_PREVIEW_MIGRATION_VERSION
  ) {
    return null;
  }
  return {
    projectThreadPreviewMigrationVersion: MOBILE_PROJECT_THREAD_PREVIEW_MIGRATION_VERSION,
  };
}

export function nextMobileProjectThreadPreviewUpdatedAt(input: {
  readonly now: number;
  readonly winnerUpdatedAt: number | undefined;
  readonly previousLocalUpdatedAt: number;
}): number {
  return Math.max(input.now, (input.winnerUpdatedAt ?? -1) + 1, input.previousLocalUpdatedAt + 1);
}
