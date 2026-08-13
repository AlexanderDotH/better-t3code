import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { parse } from "yaml";

const PRODUCTION_AUTOMATION_GUARD_PARTS = [
  "github.repository == 'pingdotgg/t3code'",
  "vars.T3_ENABLE_PRODUCTION_AUTOMATION == 'true'",
] as const;

const guardedJobsByWorkflow = {
  "deploy-relay.yml": ["deploy_relay"],
  "mobile-eas-production.yml": ["production"],
  "release.yml": [
    "check_changes",
    "preflight",
    "relay_public_config",
    "build_wsl_node_pty",
    "build",
    "publish_cli",
    "release",
    "deploy_web",
    "finalize",
    "announce_discord",
  ],
} as const;

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  assert.isObject(value, message);
  return value as Record<string, unknown>;
}

const readWorkflow = Effect.fn("readProductionWorkflow")(function* (filename: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const source = yield* fs.readFileString(path.join(repoRoot, ".github", "workflows", filename));
  return requireRecord(parse(source), `${filename} must decode to a workflow object`);
});

function readJobIf(workflow: Record<string, unknown>, filename: string, jobName: string): string {
  const jobs = requireRecord(workflow.jobs, `${filename} must define jobs`);
  assert.ok(Object.hasOwn(jobs, jobName), `${filename} must define ${jobName}`);
  const job = requireRecord(jobs[jobName], `${filename}:${jobName} must be a job object`);
  const condition = job.if;
  if (typeof condition !== "string") {
    return assert.fail(`${filename}:${jobName} must have an explicit production guard`);
  }
  return condition;
}

it.layer(NodeServices.layer)("production workflow policy", (it) => {
  it.effect("keeps every production job disabled unless upstream or explicitly opted in", () =>
    Effect.gen(function* () {
      for (const [filename, jobNames] of Object.entries(guardedJobsByWorkflow)) {
        const workflow = yield* readWorkflow(filename);
        for (const jobName of jobNames) {
          const condition = readJobIf(workflow, filename, jobName);
          for (const guardPart of PRODUCTION_AUTOMATION_GUARD_PARTS) {
            assert.include(condition, guardPart, `${filename}:${jobName} is missing ${guardPart}`);
          }
        }
      }
    }),
  );
});
