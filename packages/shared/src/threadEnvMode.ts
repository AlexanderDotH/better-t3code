import { PROJECT_FILE_BACKED_SETTINGS, type ThreadEnvMode } from "@t3tools/contracts";

// Explicit composer picks win; web and mobile use this fallback order for their defaults.
export function resolveDefaultThreadEnvMode(sources: {
  readonly projectSetting: ThreadEnvMode | null | undefined;
  readonly projectFile: ThreadEnvMode | null | undefined;
  readonly globalDefault: ThreadEnvMode | null | undefined;
}): ThreadEnvMode {
  return (
    sources.projectSetting ??
    sources.globalDefault ??
    sources.projectFile ??
    PROJECT_FILE_BACKED_SETTINGS.defaultThreadEnvMode.builtIn
  );
}

/**
 * True once the resolved default can no longer change: an explicit pick or a
 * source that outranks t3.json decided, or the file read settled. While
 * false, nothing may persist the provisional default (for example into a
 * draft's workspace selection) — it could differ from the final value.
 */
export function isDefaultThreadEnvModeSettled(sources: {
  readonly explicitMode: ThreadEnvMode | undefined;
  readonly projectSetting: ThreadEnvMode | null | undefined;
  readonly globalDefault?: ThreadEnvMode | null | undefined;
  readonly projectFilePending: boolean;
}): boolean {
  return (
    sources.explicitMode !== undefined ||
    sources.projectSetting != null ||
    sources.globalDefault != null ||
    !sources.projectFilePending
  );
}
