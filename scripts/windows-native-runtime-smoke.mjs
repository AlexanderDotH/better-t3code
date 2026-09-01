import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeURL from "node:url";

import {
  WINDOWS_ARGUMENT_PROBE_VALUES,
  WINDOWS_PROVIDER_PROBE_NAMES,
  evaluateProviderProbeResults,
} from "./windows-smoke-logic.mjs";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const sharedRequire = NodeModule.createRequire(
  NodePath.join(repoRoot, "packages/shared/package.json"),
);
const serverRequire = NodeModule.createRequire(NodePath.join(repoRoot, "apps/server/package.json"));

function fail(message) {
  throw new Error(message);
}

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.timeout(30_000),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code ?? "none"}${signal ? ` (${signal})` : ""}\n${stdout}${stderr}`,
        ),
      );
    });
  });
}

function lastJsonLine(output) {
  const line = output
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .findLast(Boolean);
  if (!line) fail("Probe produced no JSON output");
  return JSON.parse(line);
}

async function runProviderCommandProbes(tempRoot) {
  const probePath = NodePath.join(tempRoot, "provider-probe.mjs");
  await NodeFSP.writeFile(
    probePath,
    "const [provider, ...args] = process.argv.slice(2);\nconsole.log(JSON.stringify({ provider, args }));\n",
    "utf8",
  );

  const { resolveSpawnCommand } = await import(
    NodeURL.pathToFileURL(NodePath.join(repoRoot, "packages/shared/src/shell.ts")).href
  );
  const Effect = await import(NodeURL.pathToFileURL(sharedRequire.resolve("effect/Effect")).href);
  const results = [];

  for (const provider of WINDOWS_PROVIDER_PROBE_NAMES) {
    const shimPath = NodePath.join(tempRoot, `${provider}.cmd`);
    await NodeFSP.writeFile(
      shimPath,
      `@echo off\r\n"${process.execPath}" "%~dp0provider-probe.mjs" ${provider} %*\r\n`,
      "utf8",
    );
    const resolved = await Effect.runPromise(
      resolveSpawnCommand(shimPath, WINDOWS_ARGUMENT_PROBE_VALUES),
    );
    const result = await runFile(resolved.command, resolved.args, {
      cwd: tempRoot,
      shell: resolved.shell,
    });
    results.push(lastJsonLine(result.stdout));
  }

  const failures = evaluateProviderProbeResults(results);
  if (failures.length > 0) {
    fail(`Provider command probes failed:\n- ${failures.join("\n- ")}`);
  }
}

async function runPowerShellArgumentProbe(tempRoot) {
  const probePath = NodePath.join(tempRoot, "powershell-argument-probe.ps1");
  await NodeFSP.writeFile(
    probePath,
    [
      "param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ProbeArgs)",
      "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)",
      "@{ provider = 'powershell'; args = @($ProbeArgs) } | ConvertTo-Json -Compress",
      "",
    ].join("\r\n"),
    "utf8",
  );
  const result = await runFile("pwsh.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-File",
    probePath,
    ...WINDOWS_ARGUMENT_PROBE_VALUES,
  ]);
  const payload = lastJsonLine(result.stdout);
  const failures = evaluateProviderProbeResults(
    WINDOWS_PROVIDER_PROBE_NAMES.map((provider) => ({
      provider,
      args: provider === "gemini" ? payload.args : [...WINDOWS_ARGUMENT_PROBE_VALUES],
    })),
  );
  if (failures.length > 0) {
    fail(`PowerShell argument probe failed:\n- ${failures.join("\n- ")}`);
  }
}

async function runConPtyProbe(tempRoot) {
  const nodePty = serverRequire("node-pty");
  const token = `t3-conpty-${process.pid}`;
  await new Promise((resolve, reject) => {
    const terminal = nodePty.spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `Write-Output '${token}'`],
      {
        cols: 100,
        rows: 20,
        cwd: tempRoot,
        env: process.env,
        name: "xterm-color",
      },
    );
    let output = "";
    const timeout = setTimeout(() => {
      terminal.kill();
      reject(new Error(`ConPTY probe timed out. Output:\n${output}`));
    }, 15_000);
    terminal.onData((chunk) => {
      output += chunk;
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (exitCode !== 0 || !output.includes(token)) {
        reject(new Error(`ConPTY probe failed with ${exitCode}. Output:\n${output}`));
        return;
      }
      resolve();
    });
  });
}

async function runGitCheckpointProbe(tempRoot) {
  const workspace = NodePath.join(tempRoot, "C drive project & checkpoints");
  await NodeFSP.mkdir(workspace, { recursive: true });
  await runFile("git.exe", ["init", "--initial-branch=main"], { cwd: workspace });
  await runFile("git.exe", ["config", "user.name", "T3 Windows Smoke"], { cwd: workspace });
  await runFile("git.exe", ["config", "user.email", "windows-smoke@t3.codes"], {
    cwd: workspace,
  });
  await NodeFSP.writeFile(NodePath.join(workspace, "Grüße & checkpoint.txt"), "windows\n", "utf8");
  await runFile("git.exe", ["add", "--", "Grüße & checkpoint.txt"], { cwd: workspace });
  await runFile("git.exe", ["commit", "-m", "windows smoke checkpoint"], { cwd: workspace });
  const head = (await runFile("git.exe", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
  await runFile("git.exe", ["update-ref", "refs/t3/checkpoints/windows-smoke", head], {
    cwd: workspace,
  });
  const checkpoint = (
    await runFile("git.exe", ["rev-parse", "refs/t3/checkpoints/windows-smoke"], {
      cwd: workspace,
    })
  ).stdout.trim();
  if (checkpoint !== head) fail("Git checkpoint ref did not resolve to HEAD");
}

async function isProcessAlive(pid) {
  const result = await runFile("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 0 } else { exit 3 }`,
  ]).then(
    () => true,
    () => false,
  );
  return result;
}

async function runProcessTreeCleanupProbe(tempRoot) {
  const grandchildPath = NodePath.join(tempRoot, "grandchild.mjs");
  const parentPath = NodePath.join(tempRoot, "process-tree-parent.mjs");
  await NodeFSP.writeFile(grandchildPath, "setInterval(() => {}, 1000);\n", "utf8");
  await NodeFSP.writeFile(
    parentPath,
    [
      'import { spawn } from "node:child_process";',
      'import path from "node:path";',
      'import { fileURLToPath } from "node:url";',
      "const root = path.dirname(fileURLToPath(import.meta.url));",
      'const child = spawn(process.execPath, [path.join(root, "grandchild.mjs")], { stdio: "ignore" });',
      "console.log(JSON.stringify({ parentPid: process.pid, childPid: child.pid }));",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"),
    "utf8",
  );

  const parent = NodeChildProcess.spawn(process.execPath, [parentPath], {
    cwd: tempRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  try {
    const payload = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Process-tree fixture did not start")),
        10_000,
      );
      parent.once("error", reject);
      parent.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
        const line = output.split(/\r?\n/u).find((candidate) => candidate.trim().startsWith("{"));
        if (!line) return;
        clearTimeout(timeout);
        resolve(JSON.parse(line));
      });
    });

    await runFile("taskkill.exe", ["/PID", String(payload.parentPid), "/T", "/F"]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const survivors = [];
    for (const pid of [payload.parentPid, payload.childPid]) {
      if (await isProcessAlive(pid)) survivors.push(pid);
    }
    if (survivors.length > 0) fail(`Process-tree cleanup left PIDs alive: ${survivors.join(", ")}`);
  } finally {
    if (await isProcessAlive(parent.pid)) {
      await runFile("taskkill.exe", ["/PID", String(parent.pid), "/T", "/F"]).catch(() => {});
    }
  }
}

async function main() {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- standalone CI executable has no Effect runtime.
  const runtimePlatform = process.platform;
  // oxlint-disable-next-line t3code/no-global-process-runtime -- standalone CI executable has no Effect runtime.
  const runtimeArchitecture = process.arch;
  if (runtimePlatform !== "win32" || runtimeArchitecture !== "x64") {
    fail(
      `Windows native runtime smoke requires win32-x64, received ${runtimePlatform}-${runtimeArchitecture}`,
    );
  }

  const tempRoot = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "T3 Windows x64 Probe Grüße "),
  );
  try {
    console.log("[windows-smoke] provider command probes");
    await runProviderCommandProbes(tempRoot);
    console.log("[windows-smoke] PowerShell argument probe");
    await runPowerShellArgumentProbe(tempRoot);
    console.log("[windows-smoke] ConPTY probe");
    await runConPtyProbe(tempRoot);
    console.log("[windows-smoke] Git checkpoint probe");
    await runGitCheckpointProbe(tempRoot);
    console.log("[windows-smoke] process-tree cleanup probe");
    await runProcessTreeCleanupProbe(tempRoot);
    console.log("Windows native runtime smoke passed.");
  } finally {
    await NodeFSP.rm(tempRoot, { recursive: true, force: true });
  }
}

await Promise.race([
  main(),
  NodeTimersPromises.setTimeout(180_000, undefined, { ref: false }).then(() =>
    fail("Windows native runtime smoke timed out after 180 seconds"),
  ),
]);
