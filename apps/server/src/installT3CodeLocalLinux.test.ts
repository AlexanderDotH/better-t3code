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
    T3CODE_CANONICAL_LOCAL_APPIMAGE: NodePath.join(home, "canonical-t3code.AppImage"),
    XDG_CONFIG_HOME: NodePath.join(home, "config"),
    XDG_DATA_HOME: NodePath.join(home, "data"),
    XDG_STATE_HOME: NodePath.join(home, "state"),
  };
}

function runInstaller(input: {
  readonly appImage: string;
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
    env: installerEnvironment(input.home),
  });
}

describe("install-t3code-local-linux", () => {
  it("refuses to replace the Local T3Code launcher when the canonical /opt installation exists", () => {
    const home = makeHome();
    const appImage = NodePath.join(home, "legacy.AppImage");
    const canonicalAppImage = NodePath.join(home, "canonical-t3code.AppImage");
    writeFakeAppImage(appImage, 'printf "legacy\\n"');
    writeFakeAppImage(canonicalAppImage, 'printf "canonical\\n"');

    const install = runInstaller({ appImage, home, profile: "shared-system" });

    NodeAssert.equal(install.status, 78);
    NodeAssert.match(install.stderr, /canonical Local T3Code installation exists/);
    NodeAssert.equal(
      NodeFS.existsSync(NodePath.join(home, "data", "t3code-local", "T3CodeLocal.AppImage")),
      false,
    );
    NodeAssert.equal(
      NodeFS.existsSync(NodePath.join(home, ".local", "bin", "t3code-local")),
      false,
    );
  });

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
