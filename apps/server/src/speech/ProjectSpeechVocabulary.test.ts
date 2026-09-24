// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import type { SpeechVocabularyEntry } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
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
});

it.layer(TestLayer)("incremental speech vocabulary", (it) => {
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
        yield* fixture.fs.writeFileString(cachePath, encoded.replace('"version":1', '"version":0'));
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
