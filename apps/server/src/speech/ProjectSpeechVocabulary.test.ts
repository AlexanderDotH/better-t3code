// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId, type SpeechVocabularyEntry } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";

import { ServerConfig, layerTest as serverConfigLayerTest } from "../config.ts";
import {
  extractSpeechVocabularyFile,
  make,
  matchSpeechVocabularyFiles,
  selectSpeechVocabularyContext,
  SPEECH_VOCABULARY_CONTEXT_CHAR_LIMIT,
  speechVocabularyKeyterms,
} from "./ProjectSpeechVocabulary.ts";
import * as ProjectSpeechWorkspaceScanner from "./ProjectSpeechWorkspaceScanner.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn(original.open) };
});

const TestLayer = ProjectSpeechWorkspaceScanner.layer.pipe(Layer.provideMerge(NodeServices.layer));

const workspace = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "t3-speech-vocabulary-" });
  const root = path.join(temporary, "project");
  const config = yield* ServerConfig.pipe(Effect.provide(serverConfigLayerTest(root, temporary)));
  const cache = config.providerStatusCacheDir;
  yield* fs.makeDirectory(root);
  const write = Effect.fn("writeVocabularyFixture")(function* (
    relativePath: string,
    contents: string,
  ) {
    const absolutePath = path.join(root, relativePath);
    yield* fs.makeDirectory(path.dirname(absolutePath), { recursive: true });
    yield* fs.writeFileString(absolutePath, contents);
  });
  const createService = make.pipe(Effect.provideService(ServerConfig, config));
  return { fs, path, root, cache, temporary, write, createService };
});

it("extracts file names, declarations and actual dependency names with source locations", () => {
  const entries = extractSpeechVocabularyFile({
    path: "src/VoiceController.ts",
    content: [
      'import { Channel } from "@acme/speech/client";',
      "export class VoiceController {}",
      "export interface VoiceOptions {}",
      "export function processDictation() {}",
      "export const voiceRegistry = {};",
      "let pendingTranscript = '';",
      "export const cleanTranscript = () => '';",
    ].join("\n"),
  });
  expect(entries).toEqual(
    expect.arrayContaining([
      { kind: "file", name: "VoiceController.ts", path: "src/VoiceController.ts" },
      { kind: "class", name: "VoiceController", path: "src/VoiceController.ts", line: 2 },
      { kind: "type", name: "VoiceOptions", path: "src/VoiceController.ts", line: 3 },
      { kind: "function", name: "processDictation", path: "src/VoiceController.ts", line: 4 },
      { kind: "variable", name: "voiceRegistry", path: "src/VoiceController.ts", line: 5 },
      { kind: "variable", name: "pendingTranscript", path: "src/VoiceController.ts", line: 6 },
      { kind: "function", name: "cleanTranscript", path: "src/VoiceController.ts", line: 7 },
      { kind: "library", name: "@acme/speech", path: "src/VoiceController.ts", line: 1 },
    ]),
  );
  expect(
    extractSpeechVocabularyFile({
      path: "package.json",
      content: JSON.stringify({ dependencies: { "unlisted-voice-library": "1.0", effect: "4" } }),
    }),
  ).toEqual(
    expect.arrayContaining([
      { kind: "library", name: "unlisted-voice-library", path: "package.json" },
    ]),
  );
});

it("keeps sensitive, hidden, generated and traversing paths out of the vocabulary", () => {
  for (const path of [
    ".env",
    "credentials.json",
    "private/key.pem",
    "src/min.generated.ts",
    ".hidden.ts",
    "../outside.ts",
    "node_modules/voice/index.ts",
  ]) {
    expect(extractSpeechVocabularyFile({ path, content: "export class MustStayLocal {}" })).toEqual(
      [],
    );
  }
});

it("retains stable duplicate file candidates and narrows a spoken qualified path", () => {
  const entries = [
    ...extractSpeechVocabularyFile({
      path: "apps/web/index.ts",
      content: "export class WebBootstrap {}",
    }),
    ...extractSpeechVocabularyFile({
      path: "apps/server/index.ts",
      content: "export class ServerBootstrap {}",
    }),
  ];
  const matches = matchSpeechVocabularyFiles(entries, "index punkt ts");
  expect(matches.map((match) => match.path)).toEqual(["apps/server/index.ts", "apps/web/index.ts"]);
  expect(matches[0]?.symbols).toEqual([
    { kind: "class", name: "ServerBootstrap", path: "apps/server/index.ts", line: 1 },
  ]);
  expect(
    matchSpeechVocabularyFiles(entries, "web slash index dot ts").map((match) => match.path),
  ).toEqual(["apps/web/index.ts"]);
});

it("prioritizes spoken code names and caps both cleanup context limits without source contents", () => {
  const entries: SpeechVocabularyEntry[] = Array.from({ length: 500 }, (_, index) => ({
    kind: "class",
    name: `Unrelated${index}`,
    path: `src/other/${index}.ts`,
    line: 1,
  }));
  entries.push({ kind: "file", name: "ChatComposer.tsx", path: "apps/web/ChatComposer.tsx" });
  const selected = selectSpeechVocabularyContext(entries, "Ändere bitte den Chat Composer");
  expect(selected.entries[0]?.name).toBe("ChatComposer.tsx");
  expect(selected.entries.length).toBeLessThanOrEqual(200);
  expect(selected.context.length).toBeLessThanOrEqual(SPEECH_VOCABULARY_CONTEXT_CHAR_LIMIT);
  expect(JSON.parse(selected.context)).toEqual(selected.entries);
  expect(selected.truncated).toBe(true);
  expect(speechVocabularyKeyterms(entries).length).toBe(100);
  entries.push(
    ...Array.from({ length: 10 }, (_, index) => ({
      kind: "class" as const,
      name: "FrequentlyUsedController",
      path: `src/consumers/${index}.ts`,
      line: 1,
    })),
  );
  expect(speechVocabularyKeyterms(entries)[0]).toBe("FrequentlyUsedController");
  expect(speechVocabularyKeyterms(entries, ["UserPreferredTerm"])[0]).toBe("UserPreferredTerm");
  entries.push(
    ...Array.from({ length: 20 }, (_, index) => ({
      kind: "type" as const,
      name: "type",
      path: `src/types/${index}.ts`,
      line: 1,
    })),
  );
  expect(speechVocabularyKeyterms(entries)).not.toContain("type");
});

it.layer(TestLayer)("incremental speech vocabulary", (it) => {
  it.effect("makes a file edit between dictations available to the next cleanup snapshot", () =>
    Effect.gen(function* () {
      const fixture = yield* workspace;
      yield* fixture.write("Voice.ts", "export class BeforeRename {}");
      const service = yield* fixture.createService;
      yield* service.refresh({ workspaceRoot: fixture.root });
      yield* fixture.write("Voice.ts", "export class AfterRename {}");
      yield* TestClock.adjust("1 minute");
      const scanner = yield* ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner;
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const next = yield* fixture.createService.pipe(
        Effect.provideService(ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner, {
          scan: (root) =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(scanner.scan(root)),
            ),
        }),
      );
      yield* next.refreshInBackground({ workspaceRoot: fixture.root });
      yield* Deferred.await(started);
      const pending = yield* next
        .snapshot({ workspaceRoot: fixture.root, awaitRefresh: true })
        .pipe(Effect.forkChild);
      yield* Deferred.succeed(release, undefined);
      const snapshot = yield* Fiber.join(pending);
      expect(snapshot.entries.some((entry) => entry.name === "AfterRename")).toBe(true);
      expect(snapshot.entries.some((entry) => entry.name === "BeforeRename")).toBe(false);
    }),
  );

  it.effect("keeps files throughout a large project when the symbol budget is exhausted", () =>
    Effect.gen(function* () {
      const fixture = yield* workspace;
      const content = Array.from(
        { length: 128 },
        (_, index) => `export class Identifier${index} {}`,
      ).join("\n");
      for (let index = 0; index < 780; index++) {
        yield* fixture.write(`a/${String(index).padStart(3, "0")}.ts`, content);
      }
      yield* fixture.write("z/ActualVoiceController.ts", "export class ActualVoiceController {}");
      const service = yield* fixture.createService;
      const result = yield* service.refresh({ workspaceRoot: fixture.root });
      expect(result.entries.length).toBeLessThanOrEqual(100_000);
      expect(result.truncated).toBe(true);
      expect(result.entries.some((entry) => entry.name === "ActualVoiceController")).toBe(true);
      expect(result.entries.filter((entry) => entry.kind === "file")).toHaveLength(781);
    }),
  );

  it.effect("learns confirmed project terms, persists bounded counts, and can clear them", () =>
    Effect.gen(function* () {
      const fixture = yield* workspace;
      yield* fixture.write(
        "Voice.ts",
        "export class VoiceController {}\nexport class RareController {}",
      );
      const service = yield* fixture.createService;
      yield* service.refresh({ workspaceRoot: fixture.root });
      for (const cleanedText of ["VoiceController", "VoiceController", "RareController"]) {
        yield* service.learn({
          projectId: ProjectId.make("voice-project"),
          workspaceRoot: fixture.root,
          transcript: "Fix the voice controller; never-persist-this-sentence",
          cleanedText,
        });
      }
      const restarted = yield* fixture.createService;
      yield* restarted.learn({
        projectId: ProjectId.make("voice-project"),
        workspaceRoot: fixture.root,
        transcript: "Fix kurivio.",
        cleanedText: "Fix Curivio.",
        customKeyterms: ["Curivio Studio"],
      });
      expect(yield* restarted.learnedTerms({ projectId: ProjectId.make("voice-project") })).toEqual(
        ["VoiceController", "Curivio", "RareController"],
      );
      expect(yield* restarted.learnedTerms({ projectId: ProjectId.make("other-project") })).toEqual(
        [],
      );
      const files = yield* fixture.fs.readDirectory(
        fixture.path.join(fixture.temporary, "userdata", "speech-vocabulary"),
      );
      const stored = yield* fixture.fs.readFileString(
        fixture.path.join(fixture.temporary, "userdata", "speech-vocabulary", files[0]!),
      );
      expect(stored).toContain('"count":2');
      expect(stored).not.toContain("never-persist-this-sentence");
      yield* TestClock.adjust("1 day");
      const terms = Array.from({ length: 270 }, (_, index) => `LearnedTerm${index}`).join(" ");
      yield* restarted.learn({
        projectId: ProjectId.make("voice-project"),
        workspaceRoot: fixture.root,
        transcript: terms,
        cleanedText: terms,
      });
      const bounded = yield* restarted.learnedTerms({ projectId: ProjectId.make("voice-project") });
      expect(bounded).toHaveLength(256);
      expect(bounded[0]).toBe("VoiceController");
      yield* restarted.clearLearnedTerms({ projectId: ProjectId.make("voice-project") });
      const cleared = yield* fixture.createService;
      expect(yield* cleared.learnedTerms({ projectId: ProjectId.make("voice-project") })).toEqual(
        [],
      );
      const storedPath = fixture.path.join(
        fixture.temporary,
        "userdata",
        "speech-vocabulary",
        files[0]!,
      );
      yield* fixture.fs.writeFileString(storedPath, "{");
      const damaged = yield* fixture.createService;
      const read = yield* damaged
        .learnedTerms({ projectId: ProjectId.make("voice-project") })
        .pipe(Effect.exit);
      expect(read._tag).toBe("Failure");
      expect(yield* fixture.fs.readFileString(storedPath)).toBe("{");
    }),
  );
  it.effect(
    "reuses unchanged files, refreshes changed declarations and removes deleted files",
    () =>
      Effect.gen(function* () {
        const fixture = yield* workspace;
        yield* fixture.write("src/Voice.ts", "export class BeforeRename {}");
        yield* fixture.write("src/Keep.ts", "export class Retained {}");
        const service = yield* fixture.createService;
        const original = yield* service.refresh({ workspaceRoot: fixture.root });
        const opened = vi.mocked(NodeFSP.open);
        opened.mockClear();
        try {
          const unchanged = yield* service.refresh({ workspaceRoot: fixture.root });
          expect(unchanged.entries).toEqual(original.entries);
          expect(opened).not.toHaveBeenCalled();
          yield* fixture.write("src/Voice.ts", "export class AfterRename {}");
          yield* fixture.fs.remove(fixture.path.join(fixture.root, "src/Keep.ts"));
          const refreshed = yield* service.refresh({ workspaceRoot: fixture.root });
          expect(refreshed.entries.some((entry) => entry.name === "AfterRename")).toBe(true);
          expect(
            refreshed.entries.some((entry) =>
              ["BeforeRename", "Retained", "Keep.ts"].includes(entry.name),
            ),
          ).toBe(false);
          expect(opened).toHaveBeenCalledTimes(1);
        } finally {
          opened.mockClear();
        }
      }),
  );

  it.effect(
    "persists only local names and fingerprints, reloads the cache and separates worktrees",
    () =>
      Effect.gen(function* () {
        const fixture = yield* workspace;
        yield* fixture.write(
          "index.ts",
          "export class MainWorkspace {}\nconst secretValue = 'never-persist-this-value';",
        );
        const otherRoot = fixture.path.join(fixture.temporary, "worktree");
        yield* fixture.fs.makeDirectory(otherRoot);
        yield* fixture.fs.writeFileString(
          fixture.path.join(otherRoot, "index.ts"),
          "export class FeatureWorkspace {}",
        );
        const service = yield* fixture.createService;
        const main = yield* service.refresh({ workspaceRoot: fixture.root });
        const other = yield* service.refresh({ workspaceRoot: otherRoot });
        expect(main.entries.some((entry) => entry.name === "MainWorkspace")).toBe(true);
        expect(other.entries.some((entry) => entry.name === "MainWorkspace")).toBe(false);
        expect(other.entries.some((entry) => entry.name === "FeatureWorkspace")).toBe(true);
        const restarted = yield* fixture.createService;
        expect(yield* restarted.snapshot({ workspaceRoot: fixture.root })).toEqual(main);
        const cacheDirectory = fixture.path.join(fixture.cache, "speech-vocabulary");
        const cachedFiles = yield* fixture.fs.readDirectory(cacheDirectory);
        expect(cachedFiles).toHaveLength(2);
        for (const cachedFile of cachedFiles) {
          const persisted = yield* fixture.fs.readFileString(
            fixture.path.join(cacheDirectory, cachedFile),
          );
          expect(persisted).not.toContain("never-persist-this-value");
          expect(persisted).toContain('"fingerprint"');
        }
      }),
  );

  it.effect(
    "ignores stale cache versions and rebuilding never reads sensitive files or symlinks",
    () =>
      Effect.gen(function* () {
        const fixture = yield* workspace;
        yield* fixture.write("Voice.ts", "export class Voice {}");
        yield* fixture.write(".env", "VERY_SECRET=hidden");
        yield* fixture.write("credentials.json", '{"token":"hidden"}');
        yield* fixture.write("src/Voice.generated.ts", "export class Generated {}");
        yield* fixture.fs.symlink(
          fixture.path.join(fixture.root, "Voice.ts"),
          fixture.path.join(fixture.root, "Shortcut.ts"),
        );
        const service = yield* fixture.createService;
        const result = yield* service.refresh({ workspaceRoot: fixture.root });
        expect(result.entries.map((entry) => entry.path)).toEqual(["Voice.ts", "Voice.ts"]);
        const cacheDirectory = fixture.path.join(fixture.cache, "speech-vocabulary");
        const [cacheFile] = yield* fixture.fs.readDirectory(cacheDirectory);
        expect(cacheFile).toBeDefined();
        const cachePath = fixture.path.join(cacheDirectory, cacheFile!);
        const encoded = yield* fixture.fs.readFileString(cachePath);
        yield* fixture.fs.writeFileString(cachePath, encoded.replace('"version":2', '"version":0'));
        const restarted = yield* fixture.createService;
        expect((yield* restarted.snapshot({ workspaceRoot: fixture.root })).entries).toEqual([]);
        expect((yield* restarted.refresh({ workspaceRoot: fixture.root })).entries).toEqual(
          result.entries,
        );
      }),
  );

  it.effect(
    "starts background refresh without waiting, coalesces it and throttles starts to a minute",
    () =>
      Effect.gen(function* () {
        const fixture = yield* workspace;
        yield* fixture.write("Voice.ts", "export class Voice {}");
        const scanner = yield* ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let scanCount = 0;
        const service = yield* fixture.createService.pipe(
          Effect.provideService(ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner, {
            scan: (root) =>
              Effect.gen(function* () {
                scanCount += 1;
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
                return yield* scanner.scan(root);
              }),
          }),
        );
        yield* service.refreshInBackground({ workspaceRoot: fixture.root });
        yield* Deferred.await(started);
        expect(scanCount).toBe(1);
        yield* service.refreshInBackground({ workspaceRoot: fixture.root });
        expect(scanCount).toBe(1);
        yield* Deferred.succeed(release, undefined);
        yield* service.refresh({ workspaceRoot: fixture.root });
        yield* service.refreshInBackground({ workspaceRoot: fixture.root });
        expect(scanCount).toBe(1);
        yield* TestClock.adjust("1 minute");
        yield* service.refreshInBackground({ workspaceRoot: fixture.root });
        yield* service.refresh({ workspaceRoot: fixture.root });
        expect(scanCount).toBe(2);
      }).pipe(Effect.provide(TestClock.layer())),
  );
});
