import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { GitRebaseControlledEditor, layer } from "./GitRebaseControlledEditor.ts";

const TestLayer = layer.pipe(Layer.provideMerge(NodeServices.layer));

function run(command: string, args: readonly string[], cwd: string) {
  const result = NodeChildProcess.spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status === 0) return;
  throw new Error(result.stderr || result.error?.message || `${command} failed`);
}

describe("GitRebaseControlledEditor", () => {
  it.effect("writes the validated todo and reword message without shell interpolation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-rebase-editor-test-" });
        const todoPath = path.join(cwd, "git-rebase-todo");
        const messagePath = path.join(cwd, "COMMIT_EDITMSG");
        const oid = "a".repeat(40);
        const todo = `reword ${oid} safe subject\n`;
        const message = "subject with 'quotes' and $(no-shell)\n\nbody";

        run("git", ["init", "-b", "main"], cwd);
        const rebaseState = path.join(cwd, ".git", "rebase-merge");
        yield* fs.makeDirectory(rebaseState, { recursive: true });
        yield* fs.writeFileString(path.join(rebaseState, "stopped-sha"), `${oid}\n`);
        yield* fs.writeFileString(todoPath, "old todo\n");
        yield* fs.writeFileString(messagePath, "old message\n");

        const editor = yield* GitRebaseControlledEditor;
        yield* editor.runWithPlan({ todo, rewordMessages: { [oid]: message } }, (environment) =>
          Effect.sync(() => {
            assert.equal(environment.GIT_SEQUENCE_EDITOR.includes(todo), false);
            assert.equal(environment.GIT_EDITOR.includes(message), false);
            run(environment.GIT_SEQUENCE_EDITOR, [todoPath], cwd);
            run(environment.GIT_EDITOR, [messagePath], cwd);
          }),
        );

        assert.equal(yield* fs.readFileString(todoPath), todo);
        assert.equal(yield* fs.readFileString(messagePath), `${message}\n`);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
