import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  repositoryGroupingKeyOf,
  resolveProjectProviderInstanceEnabled,
  type EnvironmentId,
  type ModelSelection,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";

type LoadProject = Pick<
  EnvironmentProject,
  "id" | "environmentId" | "repositoryIdentity" | "archivedAt"
>;
type LoadConfig = Pick<ServerConfig, "settings"> & {
  readonly providers: ReadonlyArray<
    Pick<ServerProvider, "instanceId" | "driver" | "installed" | "availability" | "status"> & {
      readonly auth: Pick<ServerProvider["auth"], "status">;
    }
  >;
};

export function loadBalancingProjects<Project extends LoadProject>(input: {
  readonly selectedProject: Project | null;
  readonly model: ModelSelection | null;
  readonly projects: ReadonlyArray<Project>;
  readonly configs: ReadonlyMap<EnvironmentId, LoadConfig>;
  readonly connectedIds: ReadonlySet<EnvironmentId>;
  readonly weights: Readonly<Record<string, number>>;
}): ReadonlyArray<Project> {
  const selected = input.selectedProject;
  const model = input.model;
  if (!selected?.repositoryIdentity || !model) return [];
  const key = repositoryGroupingKeyOf(selected.repositoryIdentity);
  const shared = input.projects.filter(
    (project) =>
      project.repositoryIdentity &&
      repositoryGroupingKeyOf(project.repositoryIdentity) === key &&
      project.archivedAt == null,
  );
  if (new Set(shared.map((project) => project.environmentId)).size < 2) return [];
  const driver = input.configs
    .get(selected.environmentId)
    ?.providers.find((provider) => provider.instanceId === model.instanceId)?.driver;
  if (driver === undefined) return [];
  return shared.filter((project) => {
    if (
      !input.connectedIds.has(project.environmentId) ||
      (input.weights[project.environmentId] ?? 50) <= 0
    )
      return false;
    const config = input.configs.get(project.environmentId);
    const provider = config?.providers.find(
      (provider) => provider.instanceId === model.instanceId && provider.driver === driver,
    );
    return (
      config !== undefined &&
      provider !== undefined &&
      provider.installed &&
      provider.availability !== "unavailable" &&
      provider.status !== "error" &&
      provider.auth.status !== "unauthenticated" &&
      resolveProjectProviderInstanceEnabled(config.settings, project.id, provider.instanceId)
    );
  });
}
