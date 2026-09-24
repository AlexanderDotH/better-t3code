import { projectIndexingDefaultsSupported } from "@t3tools/client-runtime/project-indexing";
import {
  resolveProjectIndexSettings,
  type EnvironmentId,
  type ProjectId,
  type ProjectIndexDefaults,
  type ProjectIndexStatusV1,
  type ServerConfig,
} from "@t3tools/contracts";

export type ProjectIndexingSettingsRouteParams = {
  readonly environmentId?: string;
  readonly projectId?: string;
};

export function supportsMobileStaticProjectIndex(version: number | undefined): boolean {
  return (version ?? 0) >= 3;
}

export function findMobileProjectIndexProject<
  Project extends { readonly environmentId: EnvironmentId; readonly id: ProjectId },
>(
  projects: ReadonlyArray<Project>,
  target: ProjectIndexingSettingsRouteParams | undefined,
): Project | null {
  if (target?.environmentId === undefined || target.projectId === undefined) return null;
  return (
    projects.find(
      (project) =>
        project.environmentId === target.environmentId && project.id === target.projectId,
    ) ?? null
  );
}

export function mobileProjectIndexDefaults(config: {
  readonly environment: {
    readonly capabilities: Pick<
      ServerConfig["environment"]["capabilities"],
      "projectIndexingDefaultsVersion"
    >;
  };
  readonly settings: Pick<
    ServerConfig["settings"],
    "projectIndexingEnabled" | "projectIndexingDefaultModelSelection"
  >;
}): ProjectIndexDefaults | undefined {
  if (!projectIndexingDefaultsSupported(config.environment.capabilities)) return undefined;
  return {
    enabled: config.settings.projectIndexingEnabled,
    modelSelection: config.settings.projectIndexingDefaultModelSelection,
  };
}

export function mobileProjectIndexStatusWithDefaults(
  status: ProjectIndexStatusV1,
  defaults: ProjectIndexDefaults | undefined,
): ProjectIndexStatusV1 {
  return defaults ? { ...status, defaults } : status;
}

export function mobileProjectIndexEffectiveSettings(status: ProjectIndexStatusV1) {
  return resolveProjectIndexSettings(status.settings, status.defaults);
}
