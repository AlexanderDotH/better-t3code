import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, it } from "vite-plus/test";

const installerPath = NodePath.resolve(
  import.meta.dirname,
  "../../../scripts/install-t3code-local-linux.sh",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { force: true, recursive: true });
  }
});

function makeHome(): string {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-local-installer-"));
  temporaryDirectories.push(home);
  return home;
}

function writeFakeAppImage(filePath: string, body: string): void {
  NodeFS.writeFileSync(filePath, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  NodeFS.chmodSync(filePath, 0o755);
}

function installerEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: NodePath.join(home, "config"),
    XDG_DATA_HOME: NodePath.join(home, "data"),
    XDG_STATE_HOME: NodePath.join(home, "state"),
  };
}

function runInstaller(input: {
  readonly appImage: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly home: string;
  readonly profile?: "isolated" | "shared-system";
}) {
  const args = [installerPath];
  if (input.profile) {
    args.push("--profile", input.profile);
  }
  args.push(input.appImage);
  return NodeChildProcess.spawnSync("bash", args, {
    encoding: "utf8",
    env: {
      ...installerEnvironment(input.home),
      ...input.environment,
    },
  });
}

describe("install-t3code-local-linux", () => {
  it("atomically rotates the previous AppImage and preserves the selected profile", () => {
    const home = makeHome();
    const firstAppImage = NodePath.join(home, "first.AppImage");
    const secondAppImage = NodePath.join(home, "second.AppImage");
    writeFakeAppImage(firstAppImage, 'printf "first\\n"');
    writeFakeAppImage(secondAppImage, 'printf "second\\n"');

    const firstInstall = runInstaller({
      appImage: firstAppImage,
      home,
      profile: "shared-system",
    });
    NodeAssert.equal(firstInstall.status, 0, firstInstall.stderr);

    const secondInstall = runInstaller({ appImage: secondAppImage, home });
    NodeAssert.equal(secondInstall.status, 0, secondInstall.stderr);

    const appDirectory = NodePath.join(home, "data", "t3code-local");
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(appDirectory, "install-profile"), "utf8").trim(),
      "shared-system",
    );
    NodeAssert.match(
      NodeFS.readFileSync(NodePath.join(appDirectory, "T3CodeLocal.AppImage"), "utf8"),
      /second/,
    );
    NodeAssert.match(
      NodeFS.readFileSync(NodePath.join(appDirectory, "T3CodeLocal.previous.AppImage"), "utf8"),
      /first/,
    );
  });

  it("rolls back the AppImage and profile when a later local target commit fails", () => {
    const home = makeHome();
    const firstAppImage = NodePath.join(home, "first.AppImage");
    const secondAppImage = NodePath.join(home, "second.AppImage");
    writeFakeAppImage(firstAppImage, 'printf "first\\n"');
    writeFakeAppImage(secondAppImage, 'printf "second\\n"');

    const firstInstall = runInstaller({
      appImage: firstAppImage,
      home,
      profile: "isolated",
    });
    NodeAssert.equal(firstInstall.status, 0, firstInstall.stderr);

    const fakeBin = NodePath.join(home, "fake-bin");
    const moveCounter = NodePath.join(home, "move-counter");
    const realMove = NodeChildProcess.execFileSync("bash", ["-c", "command -v mv"], {
      encoding: "utf8",
    }).trim();
    NodeFS.mkdirSync(fakeBin);
    NodeFS.writeFileSync(
      NodePath.join(fakeBin, "mv"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `counter=${JSON.stringify(moveCounter)}`,
        'count="$(($(cat "$counter" 2>/dev/null || printf 0) + 1))"',
        'printf "%s\\n" "$count" >"$counter"',
        'if [[ "$count" -eq 4 ]]; then exit 99; fi',
        `exec ${JSON.stringify(realMove)} "$@"`,
        "",
      ].join("\n"),
    );
    NodeFS.chmodSync(NodePath.join(fakeBin, "mv"), 0o755);

    const failedInstall = runInstaller({
      appImage: secondAppImage,
      environment: {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
      home,
      profile: "shared-system",
    });
    NodeAssert.notEqual(failedInstall.status, 0);

    const appDirectory = NodePath.join(home, "data", "t3code-local");
    NodeAssert.match(
      NodeFS.readFileSync(NodePath.join(appDirectory, "T3CodeLocal.AppImage"), "utf8"),
      /first/,
    );
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(appDirectory, "install-profile"), "utf8").trim(),
      "isolated",
    );
  });

  it("refuses to start the shared profile while the system package is running", () => {
    const home = makeHome();
    const appImage = NodePath.join(home, "fake.AppImage");
    writeFakeAppImage(appImage, "exit 0");
    const install = runInstaller({ appImage, home, profile: "shared-system" });
    NodeAssert.equal(install.status, 0, install.stderr);

    const processName = `t3code-system-test-${process.pid}`;
    const systemProcess = NodeChildProcess.spawn(
      "bash",
      ["-c", `exec -a ${processName} sleep 30`],
      { stdio: "ignore" },
    );
    NodeChildProcess.spawnSync("sleep", ["0.05"]);

    try {
      const wrapper = NodePath.join(home, ".local", "bin", "t3code-local");
      const result = NodeChildProcess.spawnSync(wrapper, [], {
        encoding: "utf8",
        env: {
          ...installerEnvironment(home),
          T3CODE_LOCAL_FOREGROUND: "1",
          T3CODE_LOCAL_SYSTEM_PROCESS_PATTERN: `^${processName}([[:space:]]|$)`,
        },
      });

      NodeAssert.equal(result.status, 75);
      NodeAssert.match(result.stderr, /Close the paru-installed T3 Code/);
    } finally {
      systemProcess.kill("SIGTERM");
    }
  });

  it("backs up and reuses the shared backend and Electron profile on first launch", () => {
    const home = makeHome();
    const environmentLog = NodePath.join(home, "environment.log");
    const appImage = NodePath.join(home, "fake.AppImage");
    writeFakeAppImage(
      appImage,
      `printf 'T3CODE_HOME=%s\\nARG=%s\\n' "$T3CODE_HOME" "$1" > "${environmentLog}"`,
    );

    const backendDirectory = NodePath.join(home, ".t3", "userdata");
    const electronDirectory = NodePath.join(home, "config", "t3code");
    NodeFS.mkdirSync(NodePath.join(backendDirectory, "secrets"), { recursive: true });
    NodeFS.mkdirSync(electronDirectory, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(backendDirectory, "settings.json"), '{"theme":"dark"}\n');
    NodeFS.writeFileSync(NodePath.join(backendDirectory, "secrets", "token.bin"), "secret");
    NodeFS.writeFileSync(NodePath.join(electronDirectory, "Preferences"), '{"locale":"en"}\n');

    const install = runInstaller({ appImage, home, profile: "shared-system" });
    NodeAssert.equal(install.status, 0, install.stderr);

    const wrapper = NodePath.join(home, ".local", "bin", "t3code-local");
    const launch = NodeChildProcess.spawnSync(wrapper, [], {
      encoding: "utf8",
      env: {
        ...installerEnvironment(home),
        T3CODE_LOCAL_FOREGROUND: "1",
        T3CODE_LOCAL_SYSTEM_PROCESS_PATTERN: "^t3code-system-process-that-does-not-exist$",
      },
    });
    NodeAssert.equal(launch.status, 0, launch.stderr);

    NodeAssert.equal(
      NodeFS.readFileSync(environmentLog, "utf8"),
      `T3CODE_HOME=${NodePath.join(home, ".t3")}\nARG=--user-data-dir=${electronDirectory}\n`,
    );

    const backupsRoot = NodePath.join(home, "state", "t3code-local", "backups");
    const backupName = NodeFS.readdirSync(backupsRoot)[0];
    if (!backupName) {
      throw new Error("shared-profile backup was not created");
    }
    const backupDirectory = NodePath.join(backupsRoot, backupName);
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(backupDirectory, "backend", "settings.json"), "utf8"),
      '{"theme":"dark"}\n',
    );
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(backupDirectory, "electron", "Preferences"), "utf8"),
      '{"locale":"en"}\n',
    );

    const appDirectory = NodePath.join(home, "data", "t3code-local");
    NodeAssert.equal(
      NodeFS.existsSync(NodePath.join(appDirectory, "shared-profile-backup-required")),
      false,
    );
    NodeAssert.equal(
      NodeFS.existsSync(NodePath.join(appDirectory, "shared-profile-backup-complete")),
      true,
    );
  });
});
