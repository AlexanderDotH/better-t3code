import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Tracer from "effect/Tracer";

import * as ProjectSpeechWorkspaceScanner from "./ProjectSpeechWorkspaceScanner.ts";

const TestLayer = ProjectSpeechWorkspaceScanner.layer.pipe(Layer.provideMerge(NodeServices.layer));
const LimitedTestLayer = Layer.effect(
  ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner,
  ProjectSpeechWorkspaceScanner.make({ entryLimit: 3 }),
).pipe(Layer.provideMerge(NodeServices.layer));

const writeTextFile = Effect.fn("writeTextFile")(function* (
  workspaceRoot: string,
  relativePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(workspaceRoot, relativePath);
  yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
  yield* fileSystem.writeFileString(absolutePath, relativePath);
});

it.layer(TestLayer)("ProjectSpeechWorkspaceScanner", (it) => {
  it.effect(
    "scans project files once without entering generated, hidden, or backup directories",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-project-speech-scan-",
        });
        yield* Effect.forEach(
          [
            "README.md",
            "package.json",
            "src/index.ts",
            "src/components/VoiceInput.tsx",
            ".git/config",
            ".codex/skills/private/SKILL.md",
            "artifacts/test-output/package.json",
            "backup/legacy/README.md",
            "Backups/archive/src/copied.ts",
            "dist/generated.js",
            "node_modules/example/index.js",
          ],
          (relativePath) => writeTextFile(workspaceRoot, relativePath),
        );

        const scanner = yield* ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner;
        const result = yield* scanner.scan(workspaceRoot);

        expect(result).toEqual({
          entries: [
            { path: "README.md", kind: "file" },
            { path: "package.json", kind: "file" },
            { path: "src", kind: "directory" },
            { path: "src/components", kind: "directory" },
            { path: "src/index.ts", kind: "file" },
            { path: "src/components/VoiceInput.tsx", kind: "file" },
          ],
          truncated: false,
        });
      }),
  );

  it.effect("records one aggregate span instead of one span per directory", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-project-speech-tracing-",
      });
      yield* Effect.forEach(["src/index.ts", "src/components/App.tsx"], (relativePath) =>
        writeTextFile(workspaceRoot, relativePath),
      );
      const spanNames: Array<string> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spanNames.push(span.name);
          return span;
        },
      });
      const scanner = yield* ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner;

      yield* scanner.scan(workspaceRoot).pipe(Effect.withTracer(tracer));

      expect(spanNames).toEqual(["ProjectSpeechWorkspaceScanner.scan"]);
    }),
  );

  it.effect("returns a typed failure when the workspace root cannot be read", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const parent = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-project-speech-missing-",
      });
      const missingRoot = path.join(parent, "missing");
      const scanner = yield* ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner;

      const error = yield* scanner.scan(missingRoot).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "ProjectSpeechWorkspaceScanError",
        workspaceRoot: missingRoot,
        relativePath: "",
      });
    }),
  );
});

it.layer(LimitedTestLayer)("ProjectSpeechWorkspaceScanner entry limit", (it) => {
  it.effect("stops the one-shot scan at the configured entry limit", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-project-speech-limited-",
      });
      yield* Effect.forEach(["a.ts", "b.ts", "c.ts", "d.ts"], (relativePath) =>
        writeTextFile(workspaceRoot, relativePath),
      );

      const scanner = yield* ProjectSpeechWorkspaceScanner.ProjectSpeechWorkspaceScanner;
      const result = yield* scanner.scan(workspaceRoot);

      expect(result).toEqual({
        entries: [
          { path: "a.ts", kind: "file" },
          { path: "b.ts", kind: "file" },
          { path: "c.ts", kind: "file" },
        ],
        truncated: true,
      });
    }),
  );
});
