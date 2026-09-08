"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

const [, , nodePtyRoot, resourceMonitorPath] = process.argv;
const timeoutMs = 20_000;
// oxlint-disable-next-line t3code/no-global-process-runtime -- standalone WSL release probe has no Effect runtime.
const runtimePlatform = process.platform;
// oxlint-disable-next-line t3code/no-global-process-runtime -- standalone WSL release probe has no Effect runtime.
const runtimeArchitecture = process.arch;

async function exercisePty() {
  const nodePty = require(nodePtyRoot);
  const marker = 'T3_WSL_PTY_Grüße_%_&_"';
  await new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const terminal = nodePty.spawn("/bin/bash", ["-lc", 'printf "%s\\n" "$T3_WSL_PROBE"'], {
      cols: 80,
      rows: 24,
      cwd: "/tmp",
      env: { ...process.env, TERM: "xterm-256color", T3_WSL_PROBE: marker },
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminal.kill();
      reject(new Error("Timed out waiting for the WSL node-pty probe."));
    }, timeoutMs);
    terminal.onData((data) => {
      output += data;
    });
    terminal.onExit(({ exitCode, signal }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        assert.equal(exitCode, 0, `node-pty exited with ${exitCode}/${signal}`);
        assert.ok(
          output.includes(marker),
          `node-pty output did not contain '${marker}': ${output}`,
        );
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function exerciseResourceMonitor() {
  const rootPid = process.pid;
  await new Promise((resolve, reject) => {
    const child = spawn(resourceMonitorPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    const lines = readline.createInterface({ input: child.stdout });
    let hello;
    let snapshot;
    let stderr = "";
    let settled = false;
    let shutdownSent = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`Timed out waiting for WSL telemetry. stderr: ${stderr}`));
    }, timeoutMs);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", finish);
    lines.on("line", (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === "hello") hello = event;
        if (event.type === "snapshot" && event.requestId === "wsl-sample") snapshot = event;
        if (hello && snapshot && !shutdownSent) {
          shutdownSent = true;
          child.stdin.write(`${JSON.stringify({ version: 4, type: "shutdown" })}\n`);
        }
      } catch (error) {
        child.kill("SIGKILL");
        finish(error);
      }
    });
    child.on("close", (code, signal) => {
      try {
        assert.equal(code, 0, `resource monitor exited with ${code}/${signal}: ${stderr}`);
        assert.equal(hello?.version, 4);
        assert.equal(hello?.platform, "linux");
        assert.equal(hello?.arch, "x86_64");
        assert.equal(hello?.capabilities?.processTree, true);
        assert.equal(hello?.capabilities?.processSuspendResume, false);
        assert.equal(snapshot?.requestId, "wsl-sample");
        assert.ok(snapshot?.memory?.totalBytes > 0);
        assert.ok(snapshot?.processes?.some((sample) => sample.pid === rootPid));
        finish();
      } catch (error) {
        finish(error);
      }
    });

    child.stdin.write(
      `${JSON.stringify({
        version: 4,
        type: "configure",
        rootPid,
        sampleIntervalMs: 0,
        externalProcesses: [],
      })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({
        version: 4,
        type: "sampleNow",
        requestId: "wsl-sample",
      })}\n`,
    );
  });
}

(async () => {
  const report = process.report.getReport();
  assert.equal(runtimePlatform, "linux");
  assert.equal(runtimeArchitecture, "x64");
  assert.ok(report.header.glibcVersionRuntime, "WSL runtime must use glibc");
  await exercisePty();
  await exerciseResourceMonitor();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      platform: runtimePlatform,
      arch: runtimeArchitecture,
      glibc: report.header.glibcVersionRuntime,
    })}\n`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
