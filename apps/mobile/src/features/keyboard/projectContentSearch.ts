import type { ProjectSearchContentsInput } from "@t3tools/contracts";

const PROJECT_CONTENT_SEARCH_LIMIT = 500;

export function buildProjectContentSearchQuery(
  input: Omit<ProjectSearchContentsInput, "limit">,
): ProjectSearchContentsInput | null {
  if (!input.cwd.trim() || !input.query.trim() || input.query.length > 256) return null;
  return { ...input, limit: PROJECT_CONTENT_SEARCH_LIMIT };
}
