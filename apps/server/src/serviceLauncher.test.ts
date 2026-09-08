import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  Launcher,
  parseServiceLauncherArguments,
  readServiceState,
  shouldSyncServiceDirectory,
  writeServiceState,
} from "./serviceLauncher.ts";
import {
  compareExactServiceVersions,
  decodeServiceStopAcknowledgement,
  decodeServiceStopRequest,
  decodeServiceState,
  isExactServiceVersion,
  SERVICE_LAUNCHER_PROTOCOL,
  SERVICE_STOP_ACK_FILE,
  SERVICE_STOP_MARKER_FILE,
  SERVICE_STOP_PROTOCOL,
  SERVICE_STOP_REQUEST_FILE,
} from "./cloud/serviceProtocol.ts";

it("requires explicit launcher paths while retaining the legacy home fallback", () => {
  assert.deepEqual(
    parseServiceLauncherArguments(
      ["--base-dir", "C:\\Users\\Alex\\.t3", "--log-path", "C:\\logs\\boot.log"],
      {},
    ),
    { baseDir: "C:\\Users\\Alex\\.t3", logPath: "C:\\logs\\boot.log" },
  );
  assert.deepEqual(parseServiceLauncherArguments([], { T3CODE_HOME: "/home/alex/.t3" }), {
    baseDir: "/home/alex/.t3",
  });
  assert.throws(() => parseServiceLauncherArguments(["--base-dir"], {}));
});

it("keeps file fsync on Windows while skipping unsupported directory fsync", () => {
  assert.isFalse(shouldSyncServiceDirectory("win32"));
  assert.isTrue(shouldSyncServiceDirectory("linux"));
  assert.isTrue(shouldSyncServiceDirectory("darwin"));
});

it("strictly decodes correlated stop requests and acknowledgements", () => {
  assert.deepEqual(decodeServiceStopRequest({ protocol: SERVICE_STOP_PROTOCOL, id: "request-1" }), {
    protocol: SERVICE_STOP_PROTOCOL,
    id: "request-1",
  });
  assert.isUndefined(decodeServiceStopRequest({ protocol: SERVICE_STOP_PROTOCOL, id: "" }));
  assert.deepEqual(
    decodeServiceStopAcknowledgement({
      protocol: SERVICE_STOP_PROTOCOL,
      id: "request-1",
      pid: 42,
      status: "stopped",
    }),
    {
      protocol: SERVICE_STOP_PROTOCOL,
      id: "request-1",
      pid: 42,
      status: "stopped",
    },
  );
  assert.isUndefined(
    decodeServiceStopAcknowledgement({
      protocol: SERVICE_STOP_PROTOCOL,
      id: "request-1",
      pid: 0,
      status: "stopped",
    }),
  );
});

it("accepts only exact semantic versions", () => {
  for (const version of ["0.0.0", "1.2.3", "1.2.3-alpha.1", "1.2.3-0", "1.2.3+001"]) {
    assert.isTrue(isExactServiceVersion(version), version);
  }
  for (const version of ["latest", "01.2.3", "1.2.3-01", "1.2.3-alpha..1", "1.2.3+."]) {
    assert.isFalse(isExactServiceVersion(version), version);
  }
});

it("orders exact semantic versions without treating build metadata as precedence", () => {
  assert.equal(compareExactServiceVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareExactServiceVersions("1.2.4", "1.2.3"), 1);
  assert.equal(compareExactServiceVersions("2.0.0-alpha.1", "2.0.0-alpha.2"), -1);
  assert.equal(compareExactServiceVersions("2.0.0-alpha.2", "2.0.0-alpha.beta"), -1);
  assert.equal(compareExactServiceVersions("2.0.0-alpha-beta", "2.0.0-alpha-alpha"), 1);
  assert.equal(compareExactServiceVersions("2.0.0", "2.0.0-rc.1"), 1);
  assert.equal(compareExactServiceVersions("2.0.0+one", "2.0.0+two"), 0);
});

it("rejects contradictory service state", () => {
  assert.isUndefined(
    decodeServiceState({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      activeVersion: "0.0.31",
      update: {
        id: "update-1",
        fromVersion: "0.0.30",
        targetVersion: "0.0.32",
        dbPath: "/tmp/state.sqlite",
        status: "pending",
      },
    }),
  );

  assert.isUndefined(
    decodeServiceState({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      activeVersion: "1.0.0",
      update: {
        id: "update-3",
        fromVersion: "1.0.0",
        targetVersion: "1.1.0",
        status: "pending",
      },
    }),
  );

  assert.isUndefined(
    decodeServiceState({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      activeVersion: "1.0.0",
      update: {
        id: "update-2",
        fromVersion: "1.0.0",
        targetVersion: "0.9.0",
        dbPath: "/tmp/state.sqlite",
        status: "pending",
      },
    }),
  );
});

it.layer(NodeServices.layer)("service state persistence", (it) => {
  it.effect("durably replaces and strictly reads one state document", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-test-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const state = {
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "0.0.31",
      } as const;

      yield* Effect.promise(() => writeServiceState(statePath, state));
      assert.deepEqual(yield* Effect.promise(() => readServiceState(statePath)), state);
    }),
  );

  it.effect("serializes shutdown with launcher recovery", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-stop-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const versionDir = path.join(root, "runtime", "versions", "1.0.0");
      const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
      yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
      yield* fs.writeFileString(entryPath, "setInterval(() => {}, 1_000);\n");
      yield* fs.writeFileString(path.join(versionDir, ".install-complete"), "1.0.0\n");
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      const running = launcher.run();
      const stopping = launcher.stop("SIGTERM");
      // An explicit stop leaves the marker that tells a child shutting down
      // mid-update that no replacement server is coming. It is present as
      // soon as stop() returns its promise, before queued transitions run.
      assert.isTrue(yield* fs.exists(path.join(root, "runtime", SERVICE_STOP_MARKER_FILE)));
      yield* Effect.promise(() => stopping);
      yield* Effect.promise(() => running);
    }),
  );

  it.effect("acknowledges a file stop request only after the child has stopped", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-stop-request-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const versionDir = path.join(root, "runtime", "versions", "1.0.0");
      const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
      yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
      yield* fs.writeFileString(entryPath, "setInterval(() => {}, 1_000);\n");
      yield* fs.writeFileString(path.join(versionDir, ".install-complete"), "1.0.0\n");
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );
      yield* fs.writeFileString(
        path.join(root, "runtime", SERVICE_STOP_REQUEST_FILE),
        JSON.stringify({ protocol: SERVICE_STOP_PROTOCOL, id: "stop-1" }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.promise(() => launcher.run());

      const acknowledgement = decodeServiceStopAcknowledgement(
        JSON.parse(yield* fs.readFileString(path.join(root, "runtime", SERVICE_STOP_ACK_FILE))),
      );
      assert.deepEqual(acknowledgement, {
        protocol: SERVICE_STOP_PROTOCOL,
        id: "stop-1",
        pid: process.pid,
        status: "stopped",
      });
      assert.isTrue(yield* fs.exists(path.join(root, "runtime", SERVICE_STOP_MARKER_FILE)));
    }),
  );

  it.effect("appends child stdout and stderr directly to the configured service log", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-log-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const logPath = path.join(root, "logs", "boot-service.log");
      const versionDir = path.join(root, "runtime", "versions", "1.0.0");
      const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
      yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
      yield* fs.writeFileString(
        entryPath,
        'process.stdout.write(`server-out home=${process.env.T3CODE_HOME}\\n`); process.stderr.write("server-error\\n"); process.exit(1);\n',
      );
      yield* fs.writeFileString(path.join(versionDir, ".install-complete"), "1.0.0\n");
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(
        root,
        yield* Effect.promise(() => readServiceState(statePath)),
        { logPath },
      );
      yield* Effect.promise(() => launcher.run().catch(() => undefined));

      const log = yield* fs.readFileString(logPath);
      assert.include(log, "[service-launcher] started");
      assert.include(log, "started active t3@1.0.0");
      assert.include(log, "server-out");
      assert.include(log, `home=${root}`);
      assert.include(log, "server-error");
    }),
  );

  it.effect("commits only after the trial reports prepared", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-flow-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true });
      yield* fs.writeFileString(databasePath, "before trial");
      // @effect-diagnostics-next-line preferSchemaOverJson:off - embeds a path in fake child source.
      const encodedDatabasePath = JSON.stringify(databasePath);
      const childSource = `
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
if (context.update?.status === "pending") {
  process.send({ type: "prepared", updateId: context.update.id });
  process.on("message", (message) => {
    if (message.type === "committed") process.exit(0);
  });
} else if (context.update === undefined) {
  process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${encodedDatabasePath} });
  setInterval(() => {}, 1_000);
} else {
  process.exit(0);
}
`;
      for (const version of ["1.0.0", "1.1.0"]) {
        const versionDir = path.join(root, "runtime", "versions", version);
        const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
        yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
        yield* fs.writeFileString(entryPath, childSource);
        yield* fs.writeFileString(path.join(versionDir, ".install-complete"), `${version}\n`);
      }
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const state = yield* Effect.promise(() => readServiceState(statePath));
      assert.equal(state.activeVersion, "1.1.0");
      assert.equal(state.update?.status, "committed");
    }),
  );

  it.effect("rolls back a trial that reports the wrong update ID", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-rollback-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true });
      yield* fs.writeFileString(databasePath, "before trial");
      // @effect-diagnostics-next-line preferSchemaOverJson:off - embeds a path in fake child source.
      const encodedDatabasePath = JSON.stringify(databasePath);
      const childSource = `
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
if (context.update?.status === "pending") {
  process.send({ type: "prepared", updateId: "wrong-update" });
} else if (context.update === undefined) {
  process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${encodedDatabasePath} });
  setInterval(() => {}, 1_000);
} else {
  process.exit(0);
}
`;
      for (const version of ["1.0.0", "1.1.0"]) {
        const versionDir = path.join(root, "runtime", "versions", version);
        const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
        yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
        yield* fs.writeFileString(entryPath, childSource);
        yield* fs.writeFileString(path.join(versionDir, ".install-complete"), `${version}\n`);
      }
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const state = yield* Effect.promise(() => readServiceState(statePath));
      assert.equal(state.activeVersion, "1.0.0");
      assert.equal(state.update?.status, "rolled-back");
      assert.equal(
        state.update?.status === "rolled-back" ? state.update.reason : undefined,
        "invalid-prepared",
      );
    }),
  );

  it.effect("restores the database when a migrating trial exits", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-db-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      const original = "database before migration";
      yield* fs.makeDirectory(path.dirname(databasePath), { recursive: true });
      yield* fs.writeFileString(databasePath, original);
      // @effect-diagnostics-next-line preferSchemaOverJson:off - embeds a path in fake child source.
      const encodedDatabasePath = JSON.stringify(databasePath);
      const childSource = `
import { writeFileSync } from "node:fs";
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
if (context.update?.status === "pending") {
  writeFileSync(context.update.dbPath, "database after migration");
  writeFileSync(context.update.dbPath + "-wal", "trial wal");
  writeFileSync(context.update.dbPath + "-shm", "trial shm");
  process.exit(1);
} else if (context.update === undefined) {
  process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${encodedDatabasePath} });
  setInterval(() => {}, 1_000);
} else {
  process.exit(0);
}
`;
      for (const version of ["1.0.0", "1.1.0"]) {
        const versionDir = path.join(root, "runtime", "versions", version);
        const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
        yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
        yield* fs.writeFileString(entryPath, childSource);
        yield* fs.writeFileString(path.join(versionDir, ".install-complete"), `${version}\n`);
      }
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const state = yield* Effect.promise(() => readServiceState(statePath));
      assert.equal(state.activeVersion, "1.0.0");
      assert.equal(state.update?.status, "rolled-back");
      assert.equal(yield* fs.readFileString(databasePath), original);
      assert.isFalse(yield* fs.exists(`${databasePath}-wal`));
      assert.isFalse(yield* fs.exists(`${databasePath}-shm`));
      const updateId = state.update?.id;
      assert.isDefined(updateId);
      assert.isFalse(yield* fs.exists(path.join(root, "runtime", "db-backup", updateId)));
    }),
  );
});
