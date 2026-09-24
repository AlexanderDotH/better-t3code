import { createFileRoute } from "@tanstack/react-router";
import { ProjectsSettings } from "../components/settings/ProjectsSettings";

export const Route = createFileRoute("/settings/projects")({
  validateSearch: (search: Record<string, unknown>) => ({
    project: typeof search.project === "string" ? search.project : undefined,
    machine: typeof search.machine === "string" ? search.machine : undefined,
    ...(typeof search.indexing === "string" ? { indexing: search.indexing } : {}),
  }),
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const { project, machine, indexing } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectsSettings
      projectKey={project ?? null}
      machineId={machine ?? null}
      indexingProjectId={indexing}
      onScopeChange={(project, machine) => {
        void navigate({
          search: { project: project ?? undefined, machine: machine ?? undefined },
          replace: true,
        });
      }}
    />
  );
}
