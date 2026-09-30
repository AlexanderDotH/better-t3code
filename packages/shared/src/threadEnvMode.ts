import { PROJECT_FILE_BACKED_SETTINGS, type ThreadEnvMode } from "@t3tools/contracts";

/**
 * Canonical priority order for a project's default thread env mode:
 * per-project setting > explicit environment value > checked-in t3.json > built-in default.
 *
 * An explicit composer pick outranks all of these; callers apply it before
 * consulting the defaults. Web resolves the sources imperatively at draft
 * creation, mobile reactively — both must route through this function so the
 * platforms cannot disagree on the order.
 */
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
