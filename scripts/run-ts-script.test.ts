// @effect-diagnostics nodeBuiltinImport:off - exercises a Bash launcher with isolated PATH fixtures.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

const launcherPath = NodePath.resolve(import.meta.dirname, "run-ts-script.sh");

interface FakeRuntimeInput {
  readonly node: string;
  readonly bun: string;
  readonly args?: ReadonlyArray<string>;
}

function writeExecutable(filePath: string, source: string): void {
  NodeFS.writeFileSync(filePath, source, { mode: 0o755 });
}

function runWithFakeRuntime(input: FakeRuntimeInput): NodeChildProcess.SpawnSyncReturns<string> {
  const fixtureRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-run-ts-script-"));
  const binDirectory = NodePath.join(fixtureRoot, "bin");
  NodeFS.mkdirSync(binDirectory);
  writeExecutable(NodePath.join(binDirectory, "node"), input.node);
  writeExecutable(NodePath.join(binDirectory, "bun"), input.bun);

  try {
    return NodeChildProcess.spawnSync(
      "/usr/bin/bash",
      [launcherPath, "fixture.ts", ...(input.args ?? [])],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDirectory}:/usr/bin:/bin`,
        },
      },
    );
  } finally {
    NodeFS.rmSync(fixtureRoot, { force: true, recursive: true });
  }
}

describe("run-ts-script", () => {
  it("falls back to Bun exactly once when Node cannot load TypeScript", () => {
    const result = runWithFakeRuntime({
      node: `#!/usr/bin/env bash
printf '%s\n' 'TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension .ts' >&2
exit 17
`,
      bun: `#!/usr/bin/env bash
printf 'bun-called:%s\n' "$*"
`,
      args: ["alpha", "two words"],
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "bun-called:run fixture.ts alpha two words\n");
    assert.match(result.stderr, /falling back to bun run/);
    assert.equal(/Node cannot execute TypeScript scripts/.test(result.stderr), false);
  });

  it("returns the original Node exit code for unrelated failures", () => {
    const result = runWithFakeRuntime({
      node: `#!/usr/bin/env bash
printf '%s\n' 'plain Node failure' >&2
exit 23
`,
      bun: `#!/usr/bin/env bash
printf '%s\n' 'bun must not run'
exit 0
`,
    });

    assert.equal(result.status, 23);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Node cannot execute TypeScript scripts/);
    assert.match(result.stderr, /plain Node failure/);
    assert.equal(/bun must not run/.test(result.stderr), false);
  });

  it("forwards successful Node output without invoking Bun", () => {
    const result = runWithFakeRuntime({
      node: `#!/usr/bin/env bash
printf 'node-called:%s\n' "$*"
`,
      bun: `#!/usr/bin/env bash
printf '%s\n' 'bun must not run'
exit 91
`,
      args: ["alpha"],
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "node-called:fixture.ts alpha\n");
    assert.equal(/bun must not run/.test(result.stdout), false);
  });
});
