import * as NodeCrypto from "node:crypto";
import {
  SkillEngineError,
  SkillRegistrySource,
  type ExtensionCatalogSearchInput,
  type ExtensionCatalogSearchResult,
  type SkillRegistryPreviewInput,
  type SkillRegistryPreviewResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { HttpClient, HttpIncomingMessage } from "effect/unstable/http";
import { isValidSkillName, parseSkillFile } from "./skillFile.ts";
import { mcpCatalogEntry, RegistryServer } from "./mcpCatalog.ts";

const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const MAX_SKILL_FILES = 500;
const MAX_SKILL_BYTES = 4 * 1024 * 1024;
const decodeCatalogJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeRegistrySource = Schema.decodeUnknownEffect(SkillRegistrySource);
const isRegistrySource = Schema.is(SkillRegistrySource);

function catalogJson(url: string) {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(url, { headers: { Accept: "application/json" } });
    if (response.status < 200 || response.status >= 300) {
      return yield* new SkillEngineError({
        message:
          response.status === 429
            ? "The registry is rate limited. Please try again later."
            : `The registry returned HTTP ${response.status}. Please try again or open the source.`,
      });
    }
    const text = yield* response.text;
    if (Buffer.byteLength(text) > MAX_DOWNLOAD_BYTES) {
      return yield* new SkillEngineError({ message: "The registry response is too large." });
    }
    return yield* decodeCatalogJson(text);
  }).pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(MAX_DOWNLOAD_BYTES)),
    Effect.timeout("20 seconds"),
    Effect.mapError((cause) =>
      cause instanceof SkillEngineError
        ? cause
        : new SkillEngineError({
            message:
              "Could not reach the public registry. Check the environment's connection and try again.",
            cause,
          }),
    ),
  );
}

const McpSearchResponse = Schema.Struct({
  servers: Schema.Array(
    Schema.Struct({
      server: RegistryServer,
      _meta: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
  metadata: Schema.optional(Schema.Struct({ nextCursor: Schema.optional(Schema.String) })),
});
const SkillSearchResponse = Schema.Struct({
  skills: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      source: Schema.String,
      skillId: Schema.optional(Schema.String),
      installs: Schema.optional(Schema.Number),
    }),
  ),
});
const decodeMcpSearch = Schema.decodeUnknownEffect(McpSearchResponse);
const decodeSkillSearch = Schema.decodeUnknownEffect(SkillSearchResponse);

export const searchExtensionCatalog = Effect.fn("searchExtensionCatalog")(function* (
  input: ExtensionCatalogSearchInput,
): Effect.fn.Return<ExtensionCatalogSearchResult, SkillEngineError, HttpClient.HttpClient> {
  if (input.kind === "mcp") {
    const params = new URLSearchParams({ limit: "24", version: "latest" });
    if (input.query.trim()) params.set("search", input.query.trim());
    if (input.cursor) params.set("cursor", input.cursor);
    const raw = yield* catalogJson(
      `https://registry.modelcontextprotocol.io/v0.1/servers?${params}`,
    );
    const data = yield* decodeMcpSearch(raw).pipe(
      Effect.mapError(
        (cause) =>
          new SkillEngineError({
            message: "The MCP registry returned an unsupported response.",
            cause,
          }),
      ),
    );
    return {
      entries: data.servers
        .filter((entry) => {
          const metadata = entry._meta?.["io.modelcontextprotocol.registry/official"];
          return (
            !(metadata && typeof metadata === "object" && "status" in metadata) ||
            metadata.status === "active"
          );
        })
        .map((entry) => mcpCatalogEntry(entry.server)),
      ...(data.metadata?.nextCursor ? { nextCursor: data.metadata.nextCursor } : {}),
    };
  }
  if (input.query.trim().length < 2) return { entries: [] };
  const params = new URLSearchParams({ q: input.query.trim(), limit: "24" });
  // Use the same public search API as the skills CLI; its v1 API requires Vercel OIDC.
  const raw = yield* catalogJson(`https://skills.sh/api/search?${params}`);
  const data = yield* decodeSkillSearch(raw).pipe(
    Effect.mapError(
      (cause) =>
        new SkillEngineError({
          message: "The skills registry returned an unsupported response.",
          cause,
        }),
    ),
  );
  return {
    entries: data.skills.flatMap((skill) => {
      const id = `${skill.source}/${skill.skillId ?? skill.id.split("/").at(-1)}`;
      if (!isRegistrySource(id)) return [];
      return [
        {
          id,
          kind: "skill" as const,
          name: skill.name,
          description: "",
          source: skill.source,
          sourceUrl: `https://skills.sh/${id}`,
          connections: [],
          ...(skill.installs === undefined ? {} : { installs: skill.installs }),
        },
      ];
    }),
  };
});

const SkillDownload = Schema.Struct({
  files: Schema.Array(Schema.Struct({ path: Schema.String, contents: Schema.String })),
});
const decodeSkillDownload = Schema.decodeUnknownEffect(SkillDownload);
export type RegistrySkillFile = (typeof SkillDownload.Type)["files"][number];

export function validateRegistrySkillFiles(files: readonly RegistrySkillFile[]) {
  if (files.length === 0 || files.length > MAX_SKILL_FILES)
    throw new Error("The skill has too many files or is empty.");
  const paths = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    const parts = file.path.split("/");
    if (
      file.path.length > 500 ||
      parts.some(
        (part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git",
      ) ||
      /[\\\p{Cc}:]/u.test(file.path)
    ) {
      throw new Error("The skill contains an unsafe file path.");
    }
    const key = file.path.toLowerCase();
    if (paths.has(key)) throw new Error("The skill contains duplicate file paths.");
    paths.add(key);
    bytes += Buffer.byteLength(file.contents);
    if (bytes > MAX_SKILL_BYTES) throw new Error("The skill exceeds the 4 MB installation limit.");
  }
  const main = files.find((file) => file.path === "SKILL.md");
  if (!main) throw new Error("The skill does not include SKILL.md.");
  const parsed = parseSkillFile(main.contents);
  if (!parsed.name || !isValidSkillName(parsed.name))
    throw new Error("The skill has an invalid name.");
  const contentHash = NodeCrypto.createHash("sha256")
    .update(JSON.stringify(files.toSorted((a, b) => a.path.localeCompare(b.path))))
    .digest("hex");
  return { parsed, name: parsed.name, contentHash };
}

export const downloadRegistrySkill = Effect.fn("downloadRegistrySkill")(function* (
  input: SkillRegistryPreviewInput,
) {
  yield* decodeRegistrySource(input.source).pipe(
    Effect.mapError(
      (cause) =>
        new SkillEngineError({
          message: "Use a skills.sh source in owner/repository/skill format.",
          cause,
        }),
    ),
  );
  const raw = yield* catalogJson(
    `https://skills.sh/api/download/${input.source.split("/").map(encodeURIComponent).join("/")}`,
  );
  const data = yield* decodeSkillDownload(raw).pipe(
    Effect.mapError(
      (cause) =>
        new SkillEngineError({
          message: "The registry could not provide this skill's files.",
          cause,
        }),
    ),
  );
  const validated = yield* Effect.try({
    try: () => validateRegistrySkillFiles(data.files),
    catch: (cause) =>
      new SkillEngineError({
        message: cause instanceof Error ? cause.message : "Invalid skill package.",
        cause,
      }),
  });
  return { ...validated, files: data.files };
});

export const previewRegistrySkill = Effect.fn("previewRegistrySkill")(function* (
  input: SkillRegistryPreviewInput,
): Effect.fn.Return<SkillRegistryPreviewResult, SkillEngineError, HttpClient.HttpClient> {
  const skill = yield* downloadRegistrySkill(input);
  return {
    source: input.source,
    name: skill.name,
    description: skill.parsed.description ?? "",
    body: skill.parsed.body,
    fileCount: skill.files.length,
    contentHash: skill.contentHash,
  };
});
