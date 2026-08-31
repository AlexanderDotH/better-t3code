import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

import {
  evaluateWindowsDesktopReadiness,
  isWindowsPathWithinDirectory,
} from "./windows-smoke-logic.mjs";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);
const POLL_INTERVAL_MS = 500;
const STARTUP_TIMEOUT_MS = 90_000;
const UPDATE_TIMEOUT_MS = 180_000;

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid Windows desktop smoke argument at index ${index}`);
    }
    result.set(name.slice(2), value);
  }
  return result;
}

function requiredArg(args, name) {
  const value = args.get(name)?.trim();
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function allocateLoopbackPort() {
  const server = NodeNet.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a CDP port");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function readText(path) {
  return NodeFSP.readFile(path, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
}

async function waitFor(label, timeoutMs, readValue, accepts) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await readValue();
    if (accepts(lastValue)) return lastValue;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`);
}

async function waitForDesktopReadiness(tracePath, traceOffset, capturedOutput) {
  const output = await waitFor(
    "backend and main-window readiness",
    STARTUP_TIMEOUT_MS,
    async () => `${capturedOutput()}\n${(await readText(tracePath)).slice(traceOffset)}`,
    (candidate) => evaluateWindowsDesktopReadiness(candidate).length === 0,
  );
  const failures = evaluateWindowsDesktopReadiness(output);
  if (failures.length > 0) {
    throw new Error(`Desktop readiness failed:\n- ${failures.join("\n- ")}\n${output}`);
  }
  return output;
}

async function findCdpTarget(port) {
  return waitFor(
    "Electron renderer CDP target",
    STARTUP_TIMEOUT_MS,
    async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (!response.ok) return null;
        const targets = await response.json();
        return targets.find(
          (target) => target.type === "page" && typeof target.webSocketDebuggerUrl === "string",
        );
      } catch {
        return null;
      }
    },
    Boolean,
  );
}

async function evaluateInRenderer(port, expression, allowDisconnect = false) {
  const target = await findCdpTarget(port);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const requestId = 1;
    let settled = false;
    const settle = (action, value) => {
      if (settled) return;
      settled = true;
      socket.close();
      action(value);
    };
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: requestId,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== requestId) return;
      if (message.error || message.result?.exceptionDetails) {
        settle(reject, new Error(`CDP evaluation failed: ${JSON.stringify(message)}`));
        return;
      }
      settle(resolve, message.result?.result?.value);
    });
    socket.addEventListener("error", (event) => {
      settle(reject, new Error(`CDP socket failed: ${event.message ?? "unknown error"}`));
    });
    socket.addEventListener("close", () => {
      if (allowDisconnect) settle(resolve, undefined);
      else settle(reject, new Error("CDP socket closed before the evaluation completed"));
    });
  });
}

async function getUpdateState(port) {
  return evaluateInRenderer(
    port,
    "window.desktopBridge ? window.desktopBridge.getUpdateState() : Promise.reject(new Error('desktopBridge unavailable'))",
  );
}

async function waitForUpdateState(port, statuses) {
  return waitFor(
    `desktop update state ${statuses.join(" or ")}`,
    UPDATE_TIMEOUT_MS,
    () => getUpdateState(port).catch(() => null),
    (state) => state !== null && statuses.includes(state.status),
  );
}

function writeDatabaseSentinel(databasePath, id, value) {
  const database = new NodeSqlite.DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 10000");
    database.exec(
      "CREATE TABLE IF NOT EXISTS windows_update_smoke_sentinel (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    database
      .prepare("INSERT OR REPLACE INTO windows_update_smoke_sentinel (id, value) VALUES (?, ?)")
      .run(id, value);
  } finally {
    database.close();
  }
}

function readDatabaseSentinel(databasePath, id) {
  const database = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare("SELECT value FROM windows_update_smoke_sentinel WHERE id = ?").get(id)
      ?.value;
  } finally {
    database.close();
  }
}

async function readExecutableProductVersion(executablePath) {
  const script = "(Get-Item -LiteralPath $env:T3CODE_SMOKE_EXE).VersionInfo.ProductVersion";
  const { stdout } = await execFile(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, T3CODE_SMOKE_EXE: executablePath },
      windowsHide: true,
    },
  );
  return stdout.trim();
}

async function listInstallProcesses(executablePath) {
  const script = [
    "$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ForEach-Object { @{ processId = [int]$_.ProcessId; parentProcessId = [int]$_.ParentProcessId; executablePath = $_.ExecutablePath } })",
    "$processes | ConvertTo-Json -Compress",
  ].join("; ");
  const { stdout } = await execFile(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  const installDirectory = NodePath.dirname(executablePath);
  return processes.filter((candidate) =>
    isWindowsPathWithinDirectory(installDirectory, candidate.executablePath),
  );
}

async function stopInstallProcesses(executablePath) {
  const initial = await listInstallProcesses(executablePath);
  const installProcessIds = new Set(initial.map((process) => process.processId));
  const roots = initial.filter((process) => !installProcessIds.has(process.parentProcessId));
  for (const process of roots) {
    await execFile("taskkill.exe", ["/PID", String(process.processId), "/T"], {
      windowsHide: true,
    }).catch(() => {});
  }
  await waitFor(
    "controlled desktop shutdown",
    15_000,
    () => listInstallProcesses(executablePath),
    (processes) => processes.length === 0,
  ).catch(async (error) => {
    const survivors = await listInstallProcesses(executablePath);
    for (const process of survivors) {
      await execFile("taskkill.exe", ["/PID", String(process.processId), "/T", "/F"], {
        windowsHide: true,
      }).catch(() => {});
    }
    throw error;
  });
}

async function runUpdateFlow({ port, executablePath, tracePath, t3Home, targetVersion }) {
  await evaluateInRenderer(
    port,
    "window.desktopBridge ? window.desktopBridge.checkForUpdate() : Promise.reject(new Error('desktopBridge unavailable'))",
  );
  const available = await waitForUpdateState(port, ["available", "error"]);
  if (available.status === "error") {
    throw new Error(`Update check failed: ${available.message ?? "unknown updater error"}`);
  }

  await evaluateInRenderer(port, "window.desktopBridge.downloadUpdate()");
  const downloaded = await waitForUpdateState(port, ["downloaded", "error"]);
  if (downloaded.status === "error") {
    throw new Error(`Update download failed: ${downloaded.message ?? "unknown updater error"}`);
  }

  const databasePath = NodePath.join(t3Home, "userdata", "state.sqlite");
  const sentinelId = `windows-update-${Date.now()}`;
  const sentinelValue = `preserved-${process.pid}`;
  writeDatabaseSentinel(databasePath, sentinelId, sentinelValue);
  const traceOffset = (await readText(tracePath)).length;

  await evaluateInRenderer(port, "window.desktopBridge.installUpdate()", true);

  const targetCore = targetVersion.match(/^(\d+\.\d+\.\d+)/u)?.[1];
  if (!targetCore) throw new Error(`Invalid target version: ${targetVersion}`);
  await waitFor(
    `installed executable version ${targetCore}`,
    UPDATE_TIMEOUT_MS,
    () => readExecutableProductVersion(executablePath).catch(() => ""),
    (version) => version.startsWith(targetCore),
  );
  await waitForDesktopReadiness(tracePath, traceOffset, () => "");

  const preservedValue = readDatabaseSentinel(databasePath, sentinelId);
  if (preservedValue !== sentinelValue) {
    throw new Error("The N to N+1 update did not preserve the T3 state database sentinel");
  }
}

async function main() {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- standalone release executable has no Effect runtime.
  const runtimePlatform = process.platform;
  // oxlint-disable-next-line t3code/no-global-process-runtime -- standalone release executable has no Effect runtime.
  const runtimeArchitecture = process.arch;
  if (runtimePlatform !== "win32" || runtimeArchitecture !== "x64") {
    throw new Error(
      `Windows desktop smoke driver requires win32-x64, received ${runtimePlatform}-${runtimeArchitecture}`,
    );
  }

  const args = parseArgs(process.argv.slice(2));
  const executablePath = NodePath.resolve(requiredArg(args, "exe"));
  const t3Home = NodePath.resolve(requiredArg(args, "t3-home"));
  const userDataDir = NodePath.resolve(requiredArg(args, "user-data-dir"));
  const mode = requiredArg(args, "mode");
  if (mode !== "startup" && mode !== "update") throw new Error(`Unsupported mode: ${mode}`);
  const targetVersion = mode === "update" ? requiredArg(args, "target-version") : undefined;
  const updatePort = mode === "update" ? Number(requiredArg(args, "update-port")) : undefined;
  if (
    mode === "update" &&
    (!Number.isInteger(updatePort) || updatePort < 1 || updatePort > 65535)
  ) {
    throw new Error(`Invalid update port: ${updatePort}`);
  }

  await NodeFSP.mkdir(t3Home, { recursive: true });
  await NodeFSP.mkdir(userDataDir, { recursive: true });
  const tracePath = NodePath.join(t3Home, "userdata", "logs", "desktop.trace.ndjson");
  const traceOffset = (await readText(tracePath)).length;
  const cdpPort = await allocateLoopbackPort();
  let output = "";
  const child = NodeChildProcess.spawn(
    executablePath,
    [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userDataDir}`, "--disable-gpu"],
    {
      env: {
        ...process.env,
        T3CODE_HOME: t3Home,
        ELECTRON_ENABLE_LOGGING: "1",
        ...(mode === "startup"
          ? { T3CODE_DISABLE_AUTO_UPDATE: "true" }
          : {
              T3CODE_DESKTOP_MOCK_UPDATES: "true",
              T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT: String(updatePort),
            }),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    },
  );
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });

  try {
    await waitForDesktopReadiness(tracePath, traceOffset, () => output);
    await findCdpTarget(cdpPort);
    if (mode === "update") {
      await runUpdateFlow({
        port: cdpPort,
        executablePath,
        tracePath,
        t3Home,
        targetVersion,
      });
    } else {
      await evaluateInRenderer(cdpPort, "window.close()", true).catch(() => {});
    }
    await stopInstallProcesses(executablePath);
    console.log(`Windows installed desktop ${mode} smoke passed.`);
  } catch (error) {
    const trace = await readText(tracePath);
    console.error(`Installed desktop output:\n${output}\nDesktop trace:\n${trace}`);
    throw error;
  } finally {
    await stopInstallProcesses(executablePath).catch(() => {});
  }
}

await main();
