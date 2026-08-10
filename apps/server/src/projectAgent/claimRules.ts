import type { ProjectAgentClaim, ProjectAgentClaimInput } from "@t3tools/contracts";

export interface ProjectAgentClaimConflictPair {
  readonly requested: ProjectAgentClaim;
  readonly existing: ProjectAgentClaim;
}

const INVALID_PATH_PATTERN = /[\\*?[\]{}]/;
const DRIVE_PATH_PATTERN = /^[a-z]:/i;

function normalizePathClaim(
  path: string,
  options: { readonly caseInsensitivePaths: boolean },
): ProjectAgentClaim {
  const trimmed = path.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("/") ||
    DRIVE_PATH_PATTERN.test(trimmed) ||
    INVALID_PATH_PATTERN.test(trimmed) ||
    trimmed.includes("\u0000")
  ) {
    throw new Error("Path claims must be safe project-relative logical paths.");
  }

  const segments = trimmed.split("/");
  if (segments.includes("..")) {
    throw new Error("Path claims cannot leave the project root.");
  }
  const normalized = segments.filter((segment) => segment.length > 0 && segment !== ".").join("/");
  const canonical = normalized.length === 0 ? "." : normalized;
  return {
    kind: "path",
    path: options.caseInsensitivePaths ? canonical.toLocaleLowerCase("en-US") : canonical,
  };
}

function normalizeTopicClaim(topic: string): ProjectAgentClaim {
  const normalized = topic.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  if (normalized.length === 0) {
    throw new Error("Topic claims cannot be empty.");
  }
  return { kind: "topic", topic: normalized };
}

function claimKey(claim: ProjectAgentClaim): string {
  return claim.kind === "path" ? `path:${claim.path}` : `topic:${claim.topic}`;
}

export function normalizeProjectAgentClaims(
  claims: ReadonlyArray<ProjectAgentClaimInput>,
  options: { readonly caseInsensitivePaths: boolean },
): ReadonlyArray<ProjectAgentClaim> {
  const unique = new Map<string, ProjectAgentClaim>();
  for (const claim of claims) {
    const normalized =
      claim.kind === "path"
        ? normalizePathClaim(claim.path, options)
        : normalizeTopicClaim(claim.topic);
    unique.set(claimKey(normalized), normalized);
  }
  return Array.from(unique.values());
}

function pathClaimsConflict(left: string, right: string): boolean {
  return (
    left === "." ||
    right === "." ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

export function projectAgentClaimsConflict(
  left: ProjectAgentClaim,
  right: ProjectAgentClaim,
): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "path"
    ? pathClaimsConflict(left.path, (right as Extract<ProjectAgentClaim, { kind: "path" }>).path)
    : left.topic === (right as Extract<ProjectAgentClaim, { kind: "topic" }>).topic;
}

export function findProjectAgentClaimConflicts(
  requestedClaims: ReadonlyArray<ProjectAgentClaim>,
  existingClaims: ReadonlyArray<ProjectAgentClaim>,
): ReadonlyArray<ProjectAgentClaimConflictPair> {
  const conflicts: ProjectAgentClaimConflictPair[] = [];
  for (const requested of requestedClaims) {
    for (const existing of existingClaims) {
      if (projectAgentClaimsConflict(requested, existing)) {
        conflicts.push({ requested, existing });
      }
    }
  }
  return conflicts;
}
