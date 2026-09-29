import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { CliArchiveInputMissingError, stageCliRuntimeAssets } from "./build-cli-archive.ts";

it.layer(NodeServices.layer)("CLI runtime assets", (it) => {
  it.effect("copies compiler helpers and the TypeScript worker beside the executable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cli-runtime-assets-" });
      const serverDistDir = path.join(root, "dist");
      const contentDir = path.join(root, "archive");
      yield* fs.makeDirectory(path.join(serverDistDir, "project-indexer"), { recursive: true });
      yield* fs.makeDirectory(contentDir);
      yield* fs.writeFileString(
        path.join(serverDistDir, "project-indexer/ProjectIndexer.dll"),
        "dotnet",
      );
      yield* fs.writeFileString(
        path.join(serverDistDir, "project-indexer/project-indexer-java.jar"),
        "java",
      );
      yield* fs.writeFileString(
        path.join(serverDistDir, "project-indexer-typescript-compatible.mjs"),
        "worker",
      );

      yield* stageCliRuntimeAssets({ serverDistDir, contentDir });

      assert.equal(
        yield* fs.readFileString(path.join(contentDir, "project-indexer/ProjectIndexer.dll")),
        "dotnet",
      );
      assert.equal(
        yield* fs.readFileString(path.join(contentDir, "project-indexer/project-indexer-java.jar")),
        "java",
      );
      assert.equal(
        yield* fs.readFileString(
          path.join(contentDir, "project-indexer-typescript-compatible.mjs"),
        ),
        "worker",
      );
    }),
  );

  it.effect("refuses incomplete compiler output before copying any runtime asset", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cli-runtime-assets-" });
      const serverDistDir = path.join(root, "dist");
      const contentDir = path.join(root, "archive");
      yield* fs.makeDirectory(path.join(serverDistDir, "project-indexer"), { recursive: true });
      yield* fs.makeDirectory(contentDir);

      const error = yield* stageCliRuntimeAssets({ serverDistDir, contentDir }).pipe(Effect.flip);

      assert.instanceOf(error, CliArchiveInputMissingError);
      assert.equal(
        error.inputPath,
        path.join(serverDistDir, "project-indexer-typescript-compatible.mjs"),
      );
      assert.deepEqual(yield* fs.readDirectory(contentDir), []);
    }),
  );
});
