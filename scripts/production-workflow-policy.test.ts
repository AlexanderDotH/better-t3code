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
  "publish-aur.yml": ["publish"],
  "release.yml": [
    "check_changes",
    "preflight",
    "relay_public_config",
    "build_wsl_node_pty",
    "build",
    "windows_update_smoke",
    "publish_cli",
    "release",
    "publish_aur",
    "deploy_web",
    "finalize",
    "announce_discord",
  ],
} as const;

const hostedCiRunners = {
  check: "ubuntu-24.04",
  test: "ubuntu-24.04",
  test_server: "ubuntu-24.04",
  rust: "ubuntu-24.04",
  windows_x64: "windows-2025",
  mobile_native_changes: "ubuntu-24.04",
  mobile_native_static_analysis: "macos-26",
  release_smoke: "ubuntu-24.04",
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

function readStepRun(job: Record<string, unknown>, jobName: string, stepName: string): string {
  const steps = job.steps;
  if (!Array.isArray(steps)) {
    return assert.fail(`ci.yml:${jobName} must define steps`);
  }
  const step = steps.find(
    (candidate: unknown) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "name" in candidate &&
      candidate.name === stepName,
  );
  assert.ok(step, `ci.yml:${jobName} must define the ${stepName} step`);
  const stepRecord = requireRecord(step, `ci.yml:${jobName}:${stepName} must be a step object`);
  const command = stepRecord.run;
  if (typeof command !== "string") {
    return assert.fail(`ci.yml:${jobName}:${stepName} must define a run command`);
  }
  return command;
}

function readTriggerPaths(
  workflow: Record<string, unknown>,
  filename: string,
  triggerName: string,
): ReadonlyArray<string> {
  const triggers = requireRecord(workflow.on, `${filename} must define triggers`);
  const trigger = requireRecord(
    triggers[triggerName],
    `${filename} must define the ${triggerName} trigger`,
  );
  const paths = trigger.paths;
  if (!Array.isArray(paths)) {
    return assert.fail(`${filename}:${triggerName} must define path filters`);
  }
  if (!paths.every((path: unknown) => typeof path === "string")) {
    return assert.fail(`${filename}:${triggerName} path filters must be strings`);
  }
  return paths;
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

  it.effect("blocks publication on signed installed Windows startup and update gates", () =>
    Effect.gen(function* () {
      const workflow = yield* readWorkflow("release.yml");
      const jobs = requireRecord(workflow.jobs, "release.yml must define jobs");
      const build = requireRecord(jobs.build, "release.yml must define build");
      const updateSmoke = requireRecord(
        jobs.windows_update_smoke,
        "release.yml must define windows_update_smoke",
      );
      const publishCli = requireRecord(jobs.publish_cli, "release.yml must define publish_cli");

      assert.include(
        readStepRun(build, "build", "Prepare Azure Trusted Signing"),
        "windows-prepare-trusted-signing.ps1",
      );
      const buildCommand = readStepRun(build, "build", "Build desktop artifact");
      assert.include(buildCommand, "args+=(--signed)");
      assert.include(buildCommand, "--wsl-resource-monitor-prebuild");
      assert.include(
        readStepRun(build, "build", "Smoke test signed installed Windows desktop"),
        "windows-desktop-release-smoke.ps1",
      );

      assert.equal(updateSmoke["runs-on"], "blacksmith-32vcpu-windows-2025");
      assert.include(
        readStepRun(updateSmoke, "windows_update_smoke", "Build signed mock-update base installer"),
        "--mock-updates",
      );
      assert.include(
        readStepRun(updateSmoke, "windows_update_smoke", "Exercise native Windows parity probes"),
        "windows-native-runtime-smoke.mjs",
      );
      assert.include(
        readStepRun(
          updateSmoke,
          "windows_update_smoke",
          "Exercise installed per-user Task Scheduler service",
        ),
        "windows-task-scheduler-service-smoke.ps1",
      );
      assert.include(
        readStepRun(
          updateSmoke,
          "windows_update_smoke",
          "Exercise real x64 glibc WSL terminal and telemetry",
        ),
        "windows-wsl-runtime-smoke.ps1",
      );
      assert.include(
        readStepRun(
          updateSmoke,
          "windows_update_smoke",
          "Exercise signed N to N+1 update with preserved database",
        ),
        "-Mode update",
      );
      assert.deepEqual(publishCli.needs, [
        "preflight",
        "relay_public_config",
        "build",
        "windows_update_smoke",
      ]);
    }),
  );

  it.effect("keeps parallel CI on fork-accessible hosted runners", () =>
    Effect.gen(function* () {
      const workflow = yield* readWorkflow("ci.yml");
      const jobs = requireRecord(workflow.jobs, "ci.yml must define jobs");

      for (const [jobName, runner] of Object.entries(hostedCiRunners)) {
        const job = requireRecord(jobs[jobName], `ci.yml must define ${jobName}`);
        assert.equal(job["runs-on"], runner, `ci.yml:${jobName} must use ${runner}`);
      }

      const testJob = requireRecord(jobs.test, "ci.yml must define test");
      const testCommand = readStepRun(testJob, "test", "Test");
      assert.include(testCommand, "--parallel --concurrency-limit 4");
      assert.include(testCommand, "--filter '!t3'");

      const serverJob = requireRecord(jobs.test_server, "ci.yml must define test_server");
      const strategy = requireRecord(serverJob.strategy, "ci.yml:test_server must define strategy");
      const matrix = requireRecord(strategy.matrix, "ci.yml:test_server must define a matrix");
      assert.deepEqual(matrix.shard, [1, 2, 3]);
      assert.include(readStepRun(serverJob, "test_server", "Test"), "--shard");

      const rustJob = requireRecord(jobs.rust, "ci.yml must define rust");
      assert.include(
        readStepRun(rustJob, "rust", "Check resource monitor formatting"),
        "cargo fmt",
      );
      assert.include(readStepRun(rustJob, "rust", "Test resource monitor"), "cargo test");

      const windowsJob = requireRecord(jobs.windows_x64, "ci.yml must define windows_x64");
      assert.include(
        readStepRun(
          windowsJob,
          "windows_x64",
          "Exercise real command shims, PowerShell, ConPTY, Git, and cleanup",
        ),
        "windows-native-runtime-smoke.mjs",
      );
      assert.include(
        readStepRun(windowsJob, "windows_x64", "Test native Windows resource monitor"),
        "cargo test",
      );
      assert.include(
        readStepRun(
          windowsJob,
          "windows_x64",
          "Exercise installed per-user Task Scheduler service",
        ),
        "windows-task-scheduler-service-smoke.ps1",
      );
    }),
  );

  it.effect("limits mobile automation to scripts imported by the mobile config", () =>
    Effect.gen(function* () {
      const workflows = [
        ["mobile-eas-production.yml", "push"],
        ["mobile-fingerprint-check.yml", "pull_request"],
      ] as const;

      for (const [filename, triggerName] of workflows) {
        const workflow = yield* readWorkflow(filename);
        const paths = readTriggerPaths(workflow, filename, triggerName);
        assert.notInclude(paths, "scripts/**");
        assert.include(paths, "scripts/lib/brand-assets.ts");
        assert.include(paths, "scripts/lib/public-config.ts");
      }
    }),
  );
});
