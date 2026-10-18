import {
  SkillEngineError,
  SkillRegistrySource,
  type ExtensionCatalogEntry,
  type ExtensionCatalogSearchInput,
  type ExtensionCatalogSearchResult,
  type SkillRegistryPreviewInput,
  type SkillRegistryPreviewResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { catalogJson } from "./catalogHttp.ts";
import { normalizeCatalogQuery, rankCatalogEntries } from "./catalogSearch.ts";
import { searchFuzzyCatalog } from "./catalogFuzzySearch.ts";
import { searchMcpCatalogs } from "./mcpCatalogSearch.ts";
import { readRepositorySkills } from "./skillRepository.ts";
import { cachedRepositorySkillRename } from "./skillRepositoryRenames.ts";
import { validateRegistrySkillFiles } from "./skillPackage.ts";

export { validateRegistrySkillFiles } from "./skillPackage.ts";
export type { RegistrySkillFile } from "./skillPackage.ts";

const PAGE_SIZE = 24;
const SKILL_SEARCH_LIMIT = 100;
const decodeRegistrySource = Schema.decodeUnknownEffect(SkillRegistrySource);
const isRegistrySource = Schema.is(SkillRegistrySource);

const skillSuggestions: ExtensionCatalogEntry[] = [
  [
    "vercel-labs/agent-skills/vercel-react-best-practices",
    "React best practices",
    "Improve React and Next.js performance and rendering patterns.",
  ],
  [
    "anthropics/skills/frontend-design",
    "Frontend design",
    "Build polished interfaces with a clear visual direction.",
  ],
  [
    "vercel-labs/agent-skills/web-design-guidelines",
    "Web design guidelines",
    "Review interfaces for accessibility, usability, and consistency.",
  ],
  [
    "anthropics/skills/webapp-testing",
    "Web app testing",
    "Test web applications and investigate UI behavior with Playwright.",
  ],
  [
    "vercel-labs/agent-skills/vercel-composition-patterns",
    "React composition patterns",
    "Design reusable React components with simpler, composable APIs.",
  ],
  [
    "anthropics/skills/skill-creator",
    "Skill creator",
    "Create, improve, and evaluate your own agent skills.",
  ],
  [
    "anthropics/skills/mcp-builder",
    "MCP builder",
    "Build MCP servers that connect agents to external services.",
  ],
  ["anthropics/skills/pdf", "PDF", "Read, create, and edit PDF documents."],
  ["anthropics/skills/docx", "Word documents", "Create and edit Word documents."],
  ["anthropics/skills/pptx", "Presentations", "Create and edit PowerPoint presentations."],
  ["anthropics/skills/xlsx", "Spreadsheets", "Work with spreadsheets, formulas, and data."],
  ["anthropics/skills/canvas-design", "Canvas design", "Create visual designs and artwork."],
  ["anthropics/skills/algorithmic-art", "Algorithmic art", "Create generative art with code."],
  ["anthropics/skills/web-artifacts-builder", "Web artifacts", "Build interactive web artifacts."],
  [
    "anthropics/skills/theme-factory",
    "Themes",
    "Apply coordinated themes to documents and web artifacts.",
  ],
  ["vercel-labs/skills/find-skills", "Find skills", "Discover more skills for a task."],
].map(([id, name, description]) => ({
  id: id!,
  name: name!,
  description: description!,
  kind: "skill",
  source: id!.split("/").slice(0, 2).join("/"),
  sourceUrl: "https://skills.sh/" + id,
  connections: [],
}));

const SkillSearchResponse = Schema.Struct({
  skills: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      source: Schema.String,
      skillId: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
      installs: Schema.optional(Schema.Number),
    }),
  ),
});
const decodeSkillSearch = Schema.decodeUnknownEffect(SkillSearchResponse);

function skillPage(
  entries: readonly ExtensionCatalogEntry[],
  cursor?: string,
): ExtensionCatalogSearchResult {
  const offset = cursor && /^skills:\d+$/.test(cursor) ? Number(cursor.slice(7)) : 0;
  return {
    entries: entries.slice(offset, offset + PAGE_SIZE),
    ...(offset + PAGE_SIZE < entries.length
      ? { nextCursor: "skills:" + (offset + PAGE_SIZE) }
      : {}),
  };
}

const lookupSkillCatalog = Effect.fn("lookupSkillCatalog")(function* (query: string) {
  const params = new URLSearchParams({ q: query, limit: String(SKILL_SEARCH_LIMIT) });
  // The CLI search is public; the v1 API requires Vercel OIDC.
  const raw = yield* catalogJson("https://skills.sh/api/search?" + params);
  const data = yield* decodeSkillSearch(raw).pipe(
    Effect.mapError(
      (cause) =>
        new SkillEngineError({
          message: "The skills registry returned an unsupported response.",
          cause,
        }),
    ),
  );
  const unique = new Map<string, ExtensionCatalogEntry>();
  const now = yield* Clock.currentTimeMillis;
  for (const skill of data.skills) {
    const originalName = skill.skillId ?? skill.id.split("/").at(-1) ?? "";
    const renamed = cachedRepositorySkillRename(skill.source, originalName, now);
    const id = skill.source + "/" + (renamed ?? originalName);
    if (!isRegistrySource(id) || unique.has(id)) continue;
    unique.set(id, {
      id,
      kind: "skill",
      name: renamed ?? skill.name,
      description: skill.description ?? "",
      source: skill.source,
      sourceUrl: renamed ? "https://github.com/" + skill.source : "https://skills.sh/" + id,
      connections: [],
      ...(skill.installs === undefined ? {} : { installs: skill.installs }),
    });
  }
  return { entries: [...unique.values()] };
});

export const searchExtensionCatalog = Effect.fn("searchExtensionCatalog")(function* (
  input: ExtensionCatalogSearchInput,
): Effect.fn.Return<ExtensionCatalogSearchResult, SkillEngineError, HttpClient.HttpClient> {
  if (input.kind === "mcp") return yield* searchMcpCatalogs(input);
  const query = input.query.trim();
  const repository =
    /^(?:https:\/\/github\.com\/)?([a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*?)\/?$/i.exec(query);
  if (repository) {
    const source = repository[1]!.replace(/\.git$/i, "").toLowerCase();
    const skills = yield* readRepositorySkills(source);
    const unique = new Map<string, ExtensionCatalogEntry>();
    for (const skill of skills) {
      const id = source + "/" + skill.name;
      if (unique.has(id)) continue;
      unique.set(id, {
        id,
        kind: "skill",
        name: skill.name,
        description: skill.description,
        source,
        sourceUrl: "https://github.com/" + source + "/tree/HEAD/" + skill.path.replace(/\/$/, ""),
        connections: [],
      });
    }
    return skillPage([...unique.values()], input.cursor);
  }
  if (query.length < 2) return { entries: skillSuggestions };
  if (isRegistrySource(query)) {
    const source = query.split("/").slice(0, 2).join("/");
    return {
      entries: [
        {
          id: query,
          kind: "skill",
          name: query.split("/")[2]!,
          description: "",
          source,
          sourceUrl: "https://github.com/" + source,
          connections: [],
        },
      ],
    };
  }
  if (input.cursor?.startsWith("fuzzy:")) {
    return yield* searchFuzzyCatalog(
      { ...input, query: normalizeCatalogQuery(query) },
      lookupSkillCatalog,
      skillSuggestions,
    );
  }
  const normalized = normalizeCatalogQuery(query);
  const result = yield* lookupSkillCatalog(normalized);
  if (!input.cursor && rankCatalogEntries(result.entries, normalized).length === 0) {
    const fuzzy = yield* searchFuzzyCatalog(
      { ...input, query: normalized },
      lookupSkillCatalog,
      skillSuggestions,
    );
    if (fuzzy.entries.length) return fuzzy;
    return {
      ...skillPage(result.entries, input.cursor),
      ...(fuzzy.warnings ? { warnings: fuzzy.warnings } : {}),
    };
  }
  return skillPage(
    rankCatalogEntries(result.entries, normalized, { includeUnmatched: true }),
    input.cursor,
  );
});

export const downloadRegistrySkill = Effect.fn("downloadRegistrySkill")(function* (
  input: SkillRegistryPreviewInput,
) {
  yield* decodeRegistrySource(input.source).pipe(
    Effect.mapError(
      (cause) =>
        new SkillEngineError({
          message: "Use a GitHub source in owner/repository/skill format.",
          cause,
        }),
    ),
  );
  const [owner, repository, name] = input.source.split("/");
  const skills = yield* readRepositorySkills(owner + "/" + repository, name!);
  const files = skills[0]!.files;
  const validated = yield* Effect.try({
    try: () => validateRegistrySkillFiles(files),
    catch: (cause) =>
      new SkillEngineError({
        message: cause instanceof Error ? cause.message : "Invalid skill package.",
        cause,
      }),
  });
  return { ...validated, files, source: owner + "/" + repository + "/" + validated.name };
});

export const previewRegistrySkill = Effect.fn("previewRegistrySkill")(function* (
  input: SkillRegistryPreviewInput,
): Effect.fn.Return<SkillRegistryPreviewResult, SkillEngineError, HttpClient.HttpClient> {
  const skill = yield* downloadRegistrySkill(input);
  return {
    source: skill.source,
    name: skill.name,
    description: skill.parsed.description ?? "",
    body: skill.parsed.body,
    fileCount: skill.files.length,
    contentHash: skill.contentHash,
  };
});
