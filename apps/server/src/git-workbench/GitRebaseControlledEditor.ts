import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

export class GitRebaseControlledEditorError extends Data.TaggedError(
  "GitRebaseControlledEditorError",
)<{
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export interface GitRebaseEditorEnvironment {
  readonly GIT_SEQUENCE_EDITOR: string;
  readonly GIT_EDITOR: string;
}

export interface GitRebaseControlledPlan {
  readonly todo: string;
  readonly rewordMessages: Readonly<Record<string, string>>;
}

export class GitRebaseControlledEditor extends Context.Service<
  GitRebaseControlledEditor,
  {
    readonly runWithPlan: <A, E, R>(
      plan: GitRebaseControlledPlan,
      run: (environment: GitRebaseEditorEnvironment) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | GitRebaseControlledEditorError, R>;
  }
>()("t3/git-workbench/GitRebaseControlledEditor") {}

function sequenceEditorSource(todo: string): string {
  const encoded = Buffer.from(todo, "utf8").toString("base64");
  return [
    "#!/usr/bin/env node",
    'import { writeFileSync } from "node:fs";',
    "const todoPath = process.argv[2];",
    "if (!todoPath) process.exit(64);",
    `writeFileSync(todoPath, Buffer.from(${JSON.stringify(encoded)}, "base64").toString("utf8"), "utf8");`,
    "",
  ].join("\n");
}

function messageEditorSource(messages: Readonly<Record<string, string>>): string {
  const encoded = Buffer.from(JSON.stringify(messages), "utf8").toString("base64");
  return [
    "#!/usr/bin/env node",
    'import { execFileSync } from "node:child_process";',
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    "const messagePath = process.argv[2];",
    "if (!messagePath) process.exit(64);",
    `const messages = JSON.parse(Buffer.from(${JSON.stringify(encoded)}, "base64").toString("utf8"));`,
    'const gitPath = (name) => execFileSync("git", ["rev-parse", "--git-path", name], { encoding: "utf8" }).trim();',
    'const stoppedShaPath = gitPath("rebase-merge/stopped-sha");',
    'const donePath = gitPath("rebase-merge/done");',
    'const stoppedSha = existsSync(stoppedShaPath) ? readFileSync(stoppedShaPath, "utf8").trim() : "";',
    'const doneLines = existsSync(donePath) ? readFileSync(donePath, "utf8").trimEnd().split("\\n").reverse() : [];',
    'const doneOid = doneLines.map((line) => /^(?:reword|r) ([0-9a-f]+)/.exec(line)?.[1]).find(Boolean) ?? "";',
    "const activeOid = stoppedSha || doneOid;",
    "if (!activeOid) process.exit(0);",
    "const oid = Object.keys(messages).find((candidate) => candidate === activeOid || candidate.startsWith(activeOid) || activeOid.startsWith(candidate));",
    "if (!oid) process.exit(0);",
    'writeFileSync(messagePath, `${messages[oid]}\\n`, "utf8");',
    "",
  ].join("\n");
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return GitRebaseControlledEditor.of({
    runWithPlan: (plan, run) =>
      Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* fileSystem.makeTempDirectoryScoped({
            prefix: "t3-git-rebase-editor-",
          });
          const sequenceEditorPath = path.join(directory, "sequence-editor.mjs");
          const messageEditorPath = path.join(directory, "message-editor.mjs");

          yield* fileSystem.writeFileString(sequenceEditorPath, sequenceEditorSource(plan.todo));
          yield* fileSystem.writeFileString(
            messageEditorPath,
            messageEditorSource(plan.rewordMessages),
          );
          yield* fileSystem.chmod(sequenceEditorPath, 0o700);
          yield* fileSystem.chmod(messageEditorPath, 0o700);

          return {
            GIT_SEQUENCE_EDITOR: sequenceEditorPath,
            GIT_EDITOR: messageEditorPath,
          } satisfies GitRebaseEditorEnvironment;
        }).pipe(
          Effect.mapError(
            (cause) =>
              new GitRebaseControlledEditorError({
                detail: "Failed to prepare the controlled interactive-rebase editor.",
                cause,
              }),
          ),
          Effect.flatMap(run),
        ),
      ),
  });
});

export const layer = Layer.effect(GitRebaseControlledEditor, make);
