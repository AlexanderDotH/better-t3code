import { SkillEngineError } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { catalogJson } from "./catalogHttp.ts";
import { isValidSkillName } from "./skillFile.ts";

const Releases = Schema.Array(
  Schema.Struct({
    body: Schema.optional(Schema.NullOr(Schema.String)),
    draft: Schema.optional(Schema.Boolean),
  }),
);
const decodeReleases = Schema.decodeUnknownEffect(Releases);
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED_REPOSITORIES = 64;
const releaseAliases = new Map<
  string,
  {
    expiresAt: number;
    aliases: ReadonlyMap<string, string>;
  }
>();

function publishedAliases(releases: typeof Releases.Type) {
  const aliases = new Map<string, string>();
  for (const release of releases) {
    if (release.draft) continue;
    let renameTable = false;
    for (const line of (release.body ?? "").split(/\r?\n/)) {
      if (!line.trim().startsWith("|")) {
        renameTable = false;
        continue;
      }
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.replaceAll("`", "").trim());
      if (cells.length !== 2) {
        renameTable = false;
        continue;
      }
      const [previous, current] = cells as [string, string];
      if (
        /^(old|previous)( (skill|name))?$/i.test(previous) &&
        /^(new|current)( (skill|name))?$/i.test(current)
      ) {
        renameTable = true;
        continue;
      }
      if (!renameTable || !isValidSkillName(previous) || !isValidSkillName(current)) continue;
      if (previous !== current && !aliases.has(previous)) aliases.set(previous, current);
    }
  }
  return aliases;
}

function renamedSkill(aliases: ReadonlyMap<string, string>, name: string) {
  let current = name;
  const visited = new Set<string>();
  while (aliases.has(current)) {
    if (visited.has(current)) return undefined;
    visited.add(current);
    current = aliases.get(current)!;
  }
  return current === name ? undefined : current;
}

export function cachedRepositorySkillRename(repository: string, name: string, now: number) {
  const cached = releaseAliases.get(repository.toLowerCase());
  return cached && cached.expiresAt > now ? renamedSkill(cached.aliases, name) : undefined;
}

export const resolveRepositorySkillRename = Effect.fn("resolveRepositorySkillRename")(function* (
  repository: string,
  name: string,
) {
  const now = yield* Clock.currentTimeMillis;
  const key = repository.toLowerCase();
  const cached = releaseAliases.get(key);
  if (cached && cached.expiresAt > now) return renamedSkill(cached.aliases, name);
  // Only missing skills consult release notes. Normal previews never need GitHub's API.
  const raw = yield* catalogJson(
    "https://api.github.com/repos/" + repository + "/releases?per_page=10",
  );
  const releases = yield* decodeReleases(raw).pipe(
    Effect.mapError(
      (cause) =>
        new SkillEngineError({
          message: "GitHub returned unsupported skill release metadata.",
          cause,
        }),
    ),
  );
  const aliases = publishedAliases(releases);
  if (releaseAliases.size >= MAX_CACHED_REPOSITORIES) {
    const oldest = releaseAliases.keys().next().value;
    if (oldest !== undefined) releaseAliases.delete(oldest);
  }
  releaseAliases.set(key, { expiresAt: now + CACHE_TTL_MS, aliases });
  return renamedSkill(aliases, name);
});
