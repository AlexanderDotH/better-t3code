// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalTimers:off
// This file is shipped as a standalone bundle and copied to a stable path by
// `t3 service update`. Keep runtime imports limited to Node built-ins.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  PendingServiceUpdate,
  ServiceLauncherChildMessage,
  ServiceLauncherContext,
  ServiceLauncherParentMessage,
  ServiceStopAcknowledgement,
  ServiceStopRequest,
  ServiceState,
  ServiceUpdateRecord,
} from "./cloud/serviceProtocol.ts";
import {
  compareExactServiceVersions,
  decodeServiceLauncherChildMessage,
  decodeServiceStopRequest,
  isExactServiceVersion,
  parseServiceState,
  SERVICE_LAUNCHER_CONTEXT_ENV,
  SERVICE_LAUNCHER_PROTOCOL,
  SERVICE_STATE_FILE,
  SERVICE_STOP_ACK_FILE,
  SERVICE_STOP_MARKER_FILE,
  SERVICE_STOP_PROTOCOL,
  SERVICE_STOP_REQUEST_FILE,
  SERVICE_WINDOWS_TASK_NAME,
} from "./cloud/serviceProtocol.ts";
import { isEntrypoint } from "./entrypoint.ts";

const HANDOFF_DELAY_MS = 2_000;
const PREPARED_TIMEOUT_MS = 120_000;
const TERMINATE_GRACE_MS = 5_000;
const STOP_REQUEST_CHECK_MS = 250;
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone launcher bundle has no Effect runtime.
const HOST_PLATFORM = NodeOS.platform();

type TerminalStatus = "committed" | "rolled-back" | "failed";
type ChildRole = "active" | "trial";

interface ManagedChild {
  readonly version: string;
  role: ChildRole;
  readonly process: NodeChildProcess.ChildProcess;
}

export interface LauncherOptions {
  readonly logPath?: string;
  readonly serviceUnit?: string;
  readonly stopRequestCheckMs?: number;
}

const runtimePaths = (baseDir: string, version: string) => {
  const versionDir = NodePath.join(baseDir, "runtime", "versions", version);
  return {
    versionDir,
    entryPath: NodePath.join(versionDir, "node_modules", "t3", "dist", "bin.mjs"),
    sentinelPath: NodePath.join(versionDir, ".install-complete"),
  };
};

/** SQLite persists across the main file plus its WAL and shared-memory sidecars. */
const DB_FILE_SUFFIXES = ["", "-wal", "-shm"] as const;
const RESTORE_MARKER = ".restore-pending";

const databaseBackupDir = (baseDir: string, updateId: string) =>
  NodePath.join(baseDir, "runtime", "db-backup", updateId);

const databaseBackupFile = (backupDir: string, suffix: (typeof DB_FILE_SUFFIXES)[number]) =>
  NodePath.join(backupDir, suffix === "" ? "database" : `database${suffix}`);

async function pathExists(target: string): Promise<boolean> {
  try {
    await NodeFSP.access(target);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return false;
    throw cause;
  }
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await NodeFSP.open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function shouldSyncServiceDirectory(platform: NodeJS.Platform): boolean {
  return platform !== "win32";
}

async function syncDirectory(directory: string): Promise<void> {
  if (!shouldSyncServiceDirectory(HOST_PLATFORM)) return;
  const handle = await NodeFSP.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Durable same-directory replacement for launcher-owned control documents. */
async function writeDurableText(filePath: string, contents: string): Promise<void> {
  const directory = NodePath.dirname(filePath);
  await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
  const tempPath = NodePath.join(
    directory,
    `.${NodePath.basename(filePath)}.${process.pid}.${NodeCrypto.randomUUID()}`,
  );
  let handle: NodeFSP.FileHandle | undefined;
  try {
    handle = await NodeFSP.open(tempPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await NodeFSP.rename(tempPath, filePath);
    await syncDirectory(directory);
  } finally {
    await handle?.close().catch(() => undefined);
    await NodeFSP.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Snapshots the database once per update before the first trial. A completed
 * backup is never overwritten because a restarted launcher may be looking at
 * database writes from an earlier attempt by the same trial.
 */
async function backupDatabaseOnce(baseDir: string, pending: PendingServiceUpdate): Promise<void> {
  const backupDir = databaseBackupDir(baseDir, pending.id);
  if (await pathExists(backupDir)) return;

  const stagingDir = `${backupDir}.staging`;
  await NodeFSP.rm(stagingDir, { recursive: true, force: true });
  await NodeFSP.mkdir(stagingDir, { recursive: true, mode: 0o700 });
  try {
    for (const suffix of DB_FILE_SUFFIXES) {
      const source = `${pending.dbPath}${suffix}`;
      if (suffix !== "" && !(await pathExists(source))) continue;
      const destination = databaseBackupFile(stagingDir, suffix);
      await NodeFSP.copyFile(source, destination);
      await syncFile(destination);
    }
    await NodeFSP.rename(stagingDir, backupDir);
    await syncDirectory(NodePath.dirname(backupDir));
  } catch (cause) {
    await NodeFSP.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    throw cause;
  }
}

const restoreMarkerPath = (baseDir: string, updateId: string) =>
  NodePath.join(databaseBackupDir(baseDir, updateId), RESTORE_MARKER);

const databaseRestorePending = (baseDir: string, pending: PendingServiceUpdate) =>
  pathExists(restoreMarkerPath(baseDir, pending.id));

/** Mark rollback before changing live files so launcher recovery cannot boot a partial restore. */
async function markDatabaseRestorePending(backupDir: string): Promise<void> {
  const markerPath = NodePath.join(backupDir, RESTORE_MARKER);
  if (!(await pathExists(markerPath))) {
    const handle = await NodeFSP.open(markerPath, "wx", 0o600);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(backupDir);
  }
}

/** Restore is retryable after any process crash while the backup directory remains. */
async function restoreDatabaseBackup(
  baseDir: string,
  pending: PendingServiceUpdate,
): Promise<void> {
  const backupDir = databaseBackupDir(baseDir, pending.id);
  if (!(await pathExists(backupDir))) return;

  await markDatabaseRestorePending(backupDir);
  for (const suffix of DB_FILE_SUFFIXES) {
    const target = `${pending.dbPath}${suffix}`;
    const source = databaseBackupFile(backupDir, suffix);
    if (await pathExists(source)) {
      await NodeFSP.copyFile(source, target);
      await syncFile(target);
    } else {
      await NodeFSP.rm(target, { force: true });
    }
  }
  await syncDirectory(NodePath.dirname(pending.dbPath));
}

async function discardDatabaseBackup(baseDir: string, updateId: string): Promise<void> {
  const backupDir = databaseBackupDir(baseDir, updateId);
  if (!(await pathExists(backupDir))) return;
  await NodeFSP.rm(backupDir, { recursive: true, force: true });
  await syncDirectory(NodePath.dirname(backupDir));
}

export async function readServiceState(filePath: string): Promise<ServiceState> {
  const contents = await NodeFSP.readFile(filePath, "utf8");
  const state = parseServiceState(contents);
  if (state === undefined) throw new Error("Service state is invalid or unsupported.");
  return state;
}

/** Durable same-directory replacement used for every runtime state transition. */
export async function writeServiceState(filePath: string, state: ServiceState): Promise<void> {
  await writeDurableText(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function runtimeExists(baseDir: string, version: string): Promise<boolean> {
  const paths = runtimePaths(baseDir, version);
  try {
    const [entry, sentinel] = await Promise.all([
      NodeFSP.stat(paths.entryPath),
      NodeFSP.readFile(paths.sentinelPath, "utf8"),
    ]);
    return entry.isFile() && sentinel.trim() === version;
  } catch {
    return false;
  }
}

function terminalUpdate<S extends TerminalStatus>(input: {
  readonly pending: PendingServiceUpdate;
  readonly status: S;
  readonly reason?: string;
}): Exclude<ServiceUpdateRecord, PendingServiceUpdate> & { readonly status: S } {
  return {
    id: input.pending.id,
    fromVersion: input.pending.fromVersion,
    targetVersion: input.pending.targetVersion,
    status: input.status,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
}

function sendMessage(
  child: NodeChildProcess.ChildProcess,
  message: ServiceLauncherParentMessage,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!child.connected || child.send === undefined) {
      reject(new Error("service child IPC is disconnected."));
      return;
    }
    child.send(message, (error) => (error === null ? resolve() : reject(error)));
  });
}

function waitForExit(child: NodeChildProcess.ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

function waitForExitWithin(
  child: NodeChildProcess.ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function terminateChild(
  child: NodeChildProcess.ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
  requestId?: string,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (HOST_PLATFORM === "win32") {
    await sendMessage(child, {
      type: "shutdown",
      requestId: requestId ?? NodeCrypto.randomUUID(),
    }).catch(() => undefined);
    if (await waitForExitWithin(child, TERMINATE_GRACE_MS)) return;
  }
  child.kill(signal);
  const force = setTimeout(() => child.kill("SIGKILL"), TERMINATE_GRACE_MS);
  try {
    await waitForExit(child);
  } finally {
    clearTimeout(force);
  }
}

const stopMarkerPath = (baseDir: string) =>
  NodePath.join(baseDir, "runtime", SERVICE_STOP_MARKER_FILE);
const stopRequestPath = (baseDir: string) =>
  NodePath.join(baseDir, "runtime", SERVICE_STOP_REQUEST_FILE);
const stopAcknowledgementPath = (baseDir: string) =>
  NodePath.join(baseDir, "runtime", SERVICE_STOP_ACK_FILE);

async function readStopRequest(baseDir: string): Promise<ServiceStopRequest | undefined> {
  try {
    const value: unknown = JSON.parse(await NodeFSP.readFile(stopRequestPath(baseDir), "utf8"));
    return decodeServiceStopRequest(value);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
    if (cause instanceof SyntaxError) return undefined;
    throw cause;
  }
}

async function writeStopAcknowledgement(
  baseDir: string,
  acknowledgement: ServiceStopAcknowledgement,
): Promise<void> {
  await writeDurableText(
    stopAcknowledgementPath(baseDir),
    `${JSON.stringify(acknowledgement, null, 2)}\n`,
  );
}

export class Launcher {
  readonly #baseDir: string;
  readonly #statePath: string;
  readonly #options: LauncherOptions;
  #state: ServiceState;
  #child: ManagedChild | null = null;
  #timer: NodeJS.Timeout | undefined;
  #stopRequestTimer: NodeJS.Timeout | undefined;
  #stopRequestReadPending = false;
  #handledStopRequestId: string | undefined;
  #logDescriptor: number | undefined;
  #transitions: Promise<void> = Promise.resolve();
  #stopRequested = false;
  #stopping = false;
  #done = false;
  readonly #completion = Promise.withResolvers<void>();

  constructor(baseDir: string, state: ServiceState, options: LauncherOptions = {}) {
    this.#baseDir = baseDir;
    this.#statePath = NodePath.join(baseDir, "runtime", SERVICE_STATE_FILE);
    this.#state = state;
    this.#options = options;
  }

  async run(): Promise<void> {
    const onSigterm = () => void this.stop("SIGTERM");
    const onSigint = () => void this.stop("SIGINT");
    process.once("SIGTERM", onSigterm);
    process.once("SIGINT", onSigint);
    try {
      await this.#openLog();
      this.#log(`started (pid ${process.pid})`);
      const initialStopRequest = await readStopRequest(this.#baseDir);
      if (initialStopRequest === undefined) {
        this.#enqueue(() => this.#recover());
        this.#startStopRequestWatcher();
      } else {
        await this.#handleStopRequest(initialStopRequest);
      }
      await this.#completion.promise;
    } finally {
      this.#clearStopRequestWatcher();
      process.off("SIGTERM", onSigterm);
      process.off("SIGINT", onSigint);
      if (this.#logDescriptor !== undefined) {
        NodeFS.closeSync(this.#logDescriptor);
        this.#logDescriptor = undefined;
      }
    }
  }

  async #openLog(): Promise<void> {
    const logPath = this.#options.logPath;
    if (logPath === undefined) return;
    await NodeFSP.mkdir(NodePath.dirname(logPath), { recursive: true, mode: 0o700 });
    this.#logDescriptor = NodeFS.openSync(logPath, "a", 0o600);
  }

  #log(message: string): void {
    if (this.#logDescriptor === undefined) return;
    try {
      NodeFS.writeSync(this.#logDescriptor, `[service-launcher] ${message}\n`);
    } catch {
      // The service manager still observes the non-zero launcher exit.
    }
  }

  #startStopRequestWatcher(): void {
    const interval = this.#options.stopRequestCheckMs ?? STOP_REQUEST_CHECK_MS;
    this.#stopRequestTimer = setInterval(() => void this.#pollStopRequest(), interval);
  }

  #clearStopRequestWatcher(): void {
    clearInterval(this.#stopRequestTimer);
    this.#stopRequestTimer = undefined;
  }

  async #pollStopRequest(): Promise<void> {
    if (this.#stopRequestReadPending || this.#done || this.#stopping) return;
    this.#stopRequestReadPending = true;
    try {
      const request = await readStopRequest(this.#baseDir);
      if (request !== undefined && request.id !== this.#handledStopRequestId) {
        await this.#handleStopRequest(request);
      }
    } catch (cause) {
      this.#enqueue(() =>
        Promise.reject(cause instanceof Error ? cause : new Error(String(cause))),
      );
    } finally {
      this.#stopRequestReadPending = false;
    }
  }

  async #handleStopRequest(request: ServiceStopRequest): Promise<void> {
    this.#handledStopRequestId = request.id;
    this.#log(`received graceful stop request ${request.id}`);
    await writeStopAcknowledgement(this.#baseDir, {
      ...request,
      pid: process.pid,
      status: "received",
    });
    await this.stop("SIGTERM", request.id);
  }

  #enqueue(transition: () => Promise<void>): void {
    this.#transitions = this.#transitions
      .then(transition, transition)
      .catch((cause: unknown) =>
        this.#fatal(cause instanceof Error ? cause : new Error(String(cause))),
      );
  }

  async #fatal(error: Error): Promise<void> {
    if (this.#done) return;
    this.#done = true;
    this.#stopping = true;
    this.#clearTimer();
    this.#clearStopRequestWatcher();
    this.#log(error.message);
    const child = this.#child?.process;
    this.#child = null;
    if (child !== undefined) await terminateChild(child);
    this.#completion.reject(error);
  }

  async stop(signal: NodeJS.Signals, requestId?: string): Promise<void> {
    // This must happen synchronously at signal receipt. A queued update
    // transition may already be terminating the active child, and that child
    // needs to see the marker in its shutdown finalizer. KillMode=mixed also
    // ensures systemd signals the launcher before the rest of the cgroup, and
    // launchd signals only the job's main process (this launcher), so the
    // marker lands before the child sees any signal on both platforms.
    try {
      NodeFS.writeFileSync(stopMarkerPath(this.#baseDir), "", { mode: 0o600 });
    } catch {
      // Err toward keeping the tunnel; the next link or unlink reconciles it.
    }
    if (this.#stopRequested || this.#stopping) {
      await this.#completion.promise.catch(() => undefined);
      if (requestId !== undefined) {
        await writeStopAcknowledgement(this.#baseDir, {
          protocol: SERVICE_STOP_PROTOCOL,
          id: requestId,
          pid: process.pid,
          status: "stopped",
        });
      }
      return;
    }
    this.#stopRequested = true;
    this.#clearTimer();
    this.#clearStopRequestWatcher();
    this.#enqueue(async () => {
      // Let an update transition already in progress start its replacement
      // before this queued stop tears it down. That replacement owns the
      // pre-activation tunnel cleanup path and observes the marker above.
      this.#stopping = true;
      const child = this.#child?.process;
      this.#child = null;
      if (child !== undefined) await terminateChild(child, signal, requestId);
      if (requestId !== undefined) {
        await writeStopAcknowledgement(this.#baseDir, {
          protocol: SERVICE_STOP_PROTOCOL,
          id: requestId,
          pid: process.pid,
          status: "stopped",
        });
      }
      this.#done = true;
      this.#completion.resolve();
    });
    await this.#completion.promise.catch(() => undefined);
  }

  #clearTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #recover(): Promise<void> {
    // A fresh launcher means servers are running again: any stop marker from
    // a previous explicit stop is stale and must not make a future update
    // handoff release its tunnel.
    await NodeFSP.rm(stopMarkerPath(this.#baseDir), { force: true }).catch(() => undefined);
    const update = this.#state.update;
    if (update?.status !== "pending") {
      if (update !== undefined) {
        await discardDatabaseBackup(this.#baseDir, update.id).catch(() => undefined);
      }
      await this.#startChild(this.#state.activeVersion, "active", update);
      return;
    }
    if (await databaseRestorePending(this.#baseDir, update)) {
      await this.#returnToPrevious(update, "failed", "rollback-interrupted");
      return;
    }
    if (!(await runtimeExists(this.#baseDir, update.targetVersion))) {
      await this.#returnToPrevious(update, "failed", "target-runtime-missing");
      return;
    }
    await this.#startTrial(update);
  }

  async #startTrial(pending: PendingServiceUpdate): Promise<void> {
    // The previous child is dead here, so all three SQLite files are quiescent.
    try {
      await backupDatabaseOnce(this.#baseDir, pending);
    } catch {
      await this.#returnToPrevious(pending, "failed", "db-backup-failed");
      return;
    }
    try {
      await this.#startChild(pending.targetVersion, "trial", pending);
    } catch {
      await this.#returnToPrevious(pending, "failed", "candidate-start-failed");
    }
  }

  async #startChild(version: string, role: ChildRole, update?: ServiceUpdateRecord): Promise<void> {
    if (this.#stopping) return;
    if (!(await runtimeExists(this.#baseDir, version))) {
      throw new Error(`Selected t3@${version} runtime is missing or incomplete.`);
    }
    if (this.#stopping) return;
    const paths = runtimePaths(this.#baseDir, version);
    const context: ServiceLauncherContext = {
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      childVersion: version,
      ...(update === undefined ? {} : { update }),
    };
    const child = NodeChildProcess.spawn(process.execPath, [paths.entryPath, "serve"], {
      env: {
        ...process.env,
        T3CODE_HOME: this.#baseDir,
        T3_BOOT_SERVICE_UNIT:
          this.#options.serviceUnit ??
          process.env.T3_BOOT_SERVICE_UNIT ??
          (HOST_PLATFORM === "win32" ? SERVICE_WINDOWS_TASK_NAME : undefined),
        [SERVICE_LAUNCHER_CONTEXT_ENV]: JSON.stringify(context),
      },
      stdio: ["ignore", this.#logDescriptor ?? "inherit", this.#logDescriptor ?? "inherit", "ipc"],
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      child.once("error", onError);
      child.once("spawn", () => {
        child.removeListener("error", onError);
        child.on("error", (error) => this.#enqueue(() => Promise.reject(error)));
        resolve();
      });
    });
    if (this.#stopping) {
      await terminateChild(child);
      return;
    }

    const managed: ManagedChild = {
      version,
      role,
      process: child,
    };
    this.#log(`started ${role} t3@${version} (pid ${String(child.pid)})`);
    this.#child = managed;
    child.on("message", (value) => {
      const message = decodeServiceLauncherChildMessage(value);
      if (message !== undefined) this.#enqueue(() => this.#handleMessage(managed, message));
    });
    child.once("exit", (code, signal) =>
      this.#enqueue(() => this.#handleExit(managed, code, signal)),
    );

    if (role === "trial") {
      this.#timer = setTimeout(
        () => this.#enqueue(() => this.#handlePreparedTimeout(managed)),
        PREPARED_TIMEOUT_MS,
      );
    }
  }

  async #handleMessage(child: ManagedChild, message: ServiceLauncherChildMessage): Promise<void> {
    if (this.#child !== child || this.#stopping) return;
    if (message.type === "request-update") {
      await this.#handleUpdateRequest(child, message);
      return;
    }
    await this.#handlePrepared(child, message.updateId);
  }

  async #handleUpdateRequest(
    child: ManagedChild,
    message: Extract<ServiceLauncherChildMessage, { readonly type: "request-update" }>,
  ): Promise<void> {
    const reject = (reason: string) =>
      sendMessage(child.process, { type: "update-rejected", reason });
    if (child.role !== "active") {
      await reject("Only the active server can request an update.");
      return;
    }
    if (child.version !== this.#state.activeVersion) {
      await reject("The requesting server is not the selected active version.");
      return;
    }
    if (this.#state.update?.status === "pending") {
      await reject("Another server update is already pending.");
      return;
    }
    if (!isExactServiceVersion(message.targetVersion)) {
      await reject("The requested target is not an exact version.");
      return;
    }
    if (compareExactServiceVersions(message.targetVersion, child.version) <= 0) {
      await reject("Remote updates must select a newer server version.");
      return;
    }
    if (!NodePath.isAbsolute(message.dbPath)) {
      await reject("The requested database path is not absolute.");
      return;
    }
    if (!(await runtimeExists(this.#baseDir, message.targetVersion))) {
      await reject("The requested target runtime is missing or incomplete.");
      return;
    }

    const pending: PendingServiceUpdate = {
      id: NodeCrypto.randomUUID(),
      fromVersion: child.version,
      targetVersion: message.targetVersion,
      dbPath: message.dbPath,
      status: "pending",
    };
    const next: ServiceState = { ...this.#state, update: pending };
    await writeServiceState(this.#statePath, next);
    this.#state = next;
    await sendMessage(child.process, { type: "update-accepted", updateId: pending.id });
    this.#timer = setTimeout(() => this.#enqueue(() => this.#beginTrial(child)), HANDOFF_DELAY_MS);
  }

  async #beginTrial(child: ManagedChild): Promise<void> {
    const pending = this.#state.update;
    if (this.#child !== child || child.role !== "active" || pending?.status !== "pending") {
      return;
    }
    this.#timer = undefined;
    this.#child = null;
    await terminateChild(child.process);
    await this.#startTrial(pending);
  }

  async #handlePrepared(child: ManagedChild, updateId: string): Promise<void> {
    const pending = this.#state.update;
    if (
      child.role !== "trial" ||
      pending?.status !== "pending" ||
      pending.id !== updateId ||
      pending.targetVersion !== child.version
    ) {
      if (child.role === "trial" && pending?.status === "pending") {
        await this.#returnToPrevious(pending, "rolled-back", "invalid-prepared", child);
        return;
      }
      throw new Error("Trial child reported prepared for an unexpected update.");
    }
    this.#clearTimer();
    const committed = terminalUpdate({ pending, status: "committed" });
    const next: ServiceState = {
      ...this.#state,
      activeVersion: pending.targetVersion,
      update: committed,
    };
    await writeServiceState(this.#statePath, next);
    this.#state = next;
    child.role = "active";
    await discardDatabaseBackup(this.#baseDir, committed.id).catch(() => undefined);
    await sendMessage(child.process, { type: "committed", updateId: committed.id });
  }

  async #handlePreparedTimeout(child: ManagedChild): Promise<void> {
    const pending = this.#state.update;
    if (this.#child !== child || child.role !== "trial" || pending?.status !== "pending") {
      return;
    }
    this.#timer = undefined;
    await this.#returnToPrevious(pending, "rolled-back", "prepared-timeout", child);
  }

  async #handleExit(
    child: ManagedChild,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    if (this.#child !== child || this.#stopping) return;
    this.#child = null;
    this.#log(`${child.role} t3@${child.version} exited (${String(code ?? signal ?? "unknown")})`);
    if (child.role === "trial") {
      this.#clearTimer();
      const pending = this.#state.update;
      if (pending?.status !== "pending") {
        throw new Error("Trial child exited without matching pending state.");
      }
      await this.#returnToPrevious(
        pending,
        "rolled-back",
        `candidate-exited:${String(code ?? signal ?? "unknown")}`,
      );
      return;
    }

    this.#clearTimer();
    const pending = this.#state.update;
    if (pending?.status === "pending") {
      await this.#startTrial(pending);
      return;
    }
    throw new Error(`Active child exited unexpectedly (${String(code ?? signal ?? "unknown")}).`);
  }

  async #returnToPrevious(
    pending: PendingServiceUpdate,
    status: "rolled-back" | "failed",
    reason: string,
    child?: ManagedChild,
  ): Promise<void> {
    if (child !== undefined) {
      this.#child = null;
      await terminateChild(child.process);
    }
    await restoreDatabaseBackup(this.#baseDir, pending);
    const outcome = terminalUpdate({ pending, status, reason });
    const next: ServiceState = {
      ...this.#state,
      activeVersion: pending.fromVersion,
      update: outcome,
    };
    await writeServiceState(this.#statePath, next);
    this.#state = next;
    await discardDatabaseBackup(this.#baseDir, pending.id).catch(() => undefined);
    await this.#startChild(next.activeVersion, "active", outcome);
  }
}

export interface ServiceLauncherArguments {
  readonly baseDir: string;
  readonly logPath?: string;
}

export function parseServiceLauncherArguments(
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
): ServiceLauncherArguments {
  let baseDir: string | undefined;
  let logPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== "--base-dir" && option !== "--log-path") {
      throw new Error(`Unknown service launcher argument '${String(option)}'.`);
    }
    const value = args[index + 1]?.trim();
    if (value === undefined || value === "") {
      throw new Error(`Service launcher argument '${option}' requires a value.`);
    }
    if (option === "--base-dir") baseDir = value;
    if (option === "--log-path") logPath = value;
    index += 1;
  }
  baseDir ??= environment.T3CODE_HOME?.trim();
  if (baseDir === undefined || baseDir === "") {
    throw new Error("T3CODE_HOME is required by the T3 Code service launcher.");
  }
  return { baseDir, ...(logPath === undefined ? {} : { logPath }) };
}

async function main(): Promise<void> {
  const options = parseServiceLauncherArguments(process.argv.slice(2), process.env);
  const { baseDir } = options;
  const statePath = NodePath.join(baseDir, "runtime", SERVICE_STATE_FILE);
  const state = await readServiceState(statePath);
  await new Launcher(baseDir, state, {
    ...(options.logPath === undefined ? {} : { logPath: options.logPath }),
    ...(process.env.T3_BOOT_SERVICE_UNIT === undefined
      ? {}
      : { serviceUnit: process.env.T3_BOOT_SERVICE_UNIT }),
  }).run();
}

if (
  isEntrypoint({
    moduleUrl: import.meta.url,
    entryPath: process.argv[1],
    runtimeMain: import.meta.main,
  })
) {
  main().catch((cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    process.stderr.write(`[service-launcher] ${error.message}\n`);
    process.exitCode = 1;
  });
}
