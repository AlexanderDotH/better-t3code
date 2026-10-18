import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpIncomingMessage } from "effect/unstable/http";
import { SkillEngineError } from "@t3tools/contracts";
import * as Yauzl from "yauzl";
import { isValidSkillName, parseSkillFile } from "./skillFile.ts";
import { resolveRepositorySkillRename } from "./skillRepositoryRenames.ts";
import { MAX_SKILL_BYTES, MAX_SKILL_FILES, type RegistrySkillFile } from "./skillPackage.ts";

const isSkillEngineError = Schema.is(SkillEngineError);
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 25_000;
const MAX_DISCOVERY_BYTES = 8 * 1024 * 1024;

interface ArchiveEntry {
  path: string;
  entry: Yauzl.Entry;
}

function openArchive(bytes: Buffer) {
  return new Promise<Yauzl.ZipFile>((resolve, reject) =>
    Yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, autoClose: false, strictFileNames: true },
      (error, archive) => {
        if (error || !archive) reject(error ?? new Error("Missing repository archive."));
        else resolve(archive);
      },
    ),
  );
}

function archiveEntries(archive: Yauzl.ZipFile) {
  return new Promise<ArchiveEntry[]>((resolve, reject) => {
    if (archive.entryCount > MAX_ARCHIVE_ENTRIES) {
      reject(new Error("The repository archive contains too many entries."));
      return;
    }
    const entries: ArchiveEntry[] = [];
    archive.on("error", reject);
    archive.on("entry", (entry: Yauzl.Entry) => {
      const slash = entry.fileName.indexOf("/");
      // GitHub archives put the repository under one enclosing directory.
      if (slash < 0) {
        reject(new Error("The repository archive has an invalid layout."));
        return;
      }
      if (!entry.fileName.endsWith("/")) {
        entries.push({ path: entry.fileName.slice(slash + 1), entry });
      }
      archive.readEntry();
    });
    archive.on("end", () => resolve(entries));
    archive.readEntry();
  });
}

function readEntry(archive: Yauzl.ZipFile, file: ArchiveEntry, maxBytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const type = (file.entry.externalFileAttributes >>> 16) & 0o170000;
    if (type === 0o120000) {
      reject(new Error("The skill contains a symbolic link."));
      return;
    }
    if (type !== 0 && type !== 0o100000) {
      reject(new Error("The skill contains an unsafe file type."));
      return;
    }
    if (file.entry.uncompressedSize > maxBytes) {
      reject(new Error("The skill exceeds the 8 MB installation limit."));
      return;
    }
    archive.openReadStream(file.entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("Could not read the repository archive."));
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      stream.on("error", reject);
      stream.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > maxBytes) {
          stream.destroy(new Error("The skill exceeds the 8 MB installation limit."));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

const repositoryArchive = Effect.fn("repositoryArchive")(
  function* (repository: string) {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(`https://codeload.github.com/${repository}/zip/HEAD`);
    if (response.status !== 200) {
      return yield* new SkillEngineError({
        message:
          response.status === 404
            ? "This public GitHub repository could not be found. Check its owner and repository name."
            : `GitHub returned HTTP ${response.status}. Try again later.`,
      });
    }
    const bytes = yield* response.arrayBuffer.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(MAX_ARCHIVE_BYTES)),
    );
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
      return yield* new SkillEngineError({
        message: "The repository archive exceeds the 32 MB download limit.",
      });
    }
    return Buffer.from(bytes);
  },
  Effect.timeout("30 seconds"),
  Effect.mapError((cause) =>
    isSkillEngineError(cause)
      ? cause
      : new SkillEngineError({
          message:
            "Could not download the public GitHub repository archive. Check the connection and repository size, then try again.",
          cause,
        }),
  ),
);

interface RepositorySkill {
  path: string;
  name: string;
  description: string;
  files: RegistrySkillFile[];
}

function archiveError(cause: unknown) {
  return new SkillEngineError({
    message:
      "Could not read the GitHub repository archive." +
      (cause instanceof Error ? " " + cause.message : ""),
    cause,
  });
}

async function repositoryMetadata(archive: Yauzl.ZipFile) {
  const entries = await archiveEntries(archive);
  const skills: RepositorySkill[] = [];
  let discoveryBytes = 0;
  for (const file of entries) {
    if (file.path.split("/").at(-1) !== "SKILL.md") continue;
    const contents = await readEntry(archive, file, MAX_SKILL_BYTES);
    discoveryBytes += contents.length;
    if (discoveryBytes > MAX_DISCOVERY_BYTES)
      throw new Error("The repository has too much skill metadata.");
    const parsed = parseSkillFile(new TextDecoder("utf-8", { fatal: true }).decode(contents));
    if (!parsed.name || !isValidSkillName(parsed.name)) continue;
    skills.push({
      path: file.path.slice(0, -"SKILL.md".length),
      name: parsed.name,
      description: parsed.description ?? "",
      files: [],
    });
  }
  return { entries, skills };
}

function matchingSkills(skills: readonly RepositorySkill[], name: string) {
  const normalized = name.toLowerCase();
  const byName = skills.filter((skill) => skill.name.toLowerCase() === normalized);
  return byName.length
    ? byName
    : skills.filter(
        (skill) => skill.path.replace(/\/$/, "").split("/").at(-1)?.toLowerCase() === normalized,
      );
}

async function readSkillFiles(
  archive: Yauzl.ZipFile,
  entries: readonly ArchiveEntry[],
  selected: RepositorySkill,
) {
  const files = entries.filter((file) => file.path.startsWith(selected.path));
  if (files.length > MAX_SKILL_FILES) throw new Error("The skill has too many files.");
  let total = 0;
  for (const file of files) {
    const contents = await readEntry(archive, file, MAX_SKILL_BYTES - total);
    total += contents.length;
    let text: string | undefined;
    try {
      if (!contents.includes(0)) text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
    } catch {
      // Binary assets are copied byte for byte with the rest of the skill.
    }
    selected.files.push({
      path: file.path.slice(selected.path.length),
      contents: text ?? contents.toString("base64"),
      ...(text === undefined ? { encoding: "base64" as const } : {}),
      ...((file.entry.externalFileAttributes >>> 16) & 0o111 ? { executable: true } : {}),
    });
  }
}

export const readRepositorySkills = Effect.fn("readRepositorySkills")(function* (
  repository: string,
  skillName?: string,
) {
  const bytes = yield* repositoryArchive(repository);
  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({ try: () => openArchive(bytes), catch: archiveError }),
    (archive) =>
      Effect.gen(function* () {
        const { entries, skills } = yield* Effect.tryPromise({
          try: () => repositoryMetadata(archive),
          catch: archiveError,
        });
        if (skillName === undefined) return skills;
        let matches = matchingSkills(skills, skillName);
        if (matches.length === 0) {
          const renamed = yield* resolveRepositorySkillRename(repository, skillName.toLowerCase());
          if (renamed) matches = matchingSkills(skills, renamed);
        }
        const [selected] = matches;
        if (matches.length !== 1 || !selected) {
          return yield* new SkillEngineError({
            message:
              matches.length > 1
                ? "This repository contains several skills with the same name. Choose an unambiguous source."
                : "This skill was renamed or removed. Search for " +
                  repository +
                  " to browse the repository's current skills.",
          });
        }
        yield* Effect.tryPromise({
          try: () => readSkillFiles(archive, entries, selected),
          catch: archiveError,
        });
        return [selected];
      }),
    (archive) => Effect.sync(() => archive.close()),
  );
});
