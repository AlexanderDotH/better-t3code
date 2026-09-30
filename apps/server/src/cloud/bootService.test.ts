import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
// @effect-diagnostics-next-line nodeBuiltinImport:off - The synchronous stop-acknowledgement hook writes a temporary test fixture.
import * as NodeFS from "node:fs";
import {
  HostProcessEnvironment,
  HostProcessExecutablePath,
  HostProcessPlatform,
  HostProcessUserId,
} from "@t3tools/shared/hostProcess";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient } from "effect/unstable/http";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import * as BootService from "./bootService.ts";
import { pinnedRuntimePaths } from "./pinnedRuntime.ts";
import {
  parseServiceState,
  SERVICE_LAUNCHER_PROTOCOL,
  SERVICE_STOP_PROTOCOL,
  SERVICE_RESTART_PENDING_FILE,
  serviceStateHasPendingUpdate,
} from "./serviceProtocol.ts";

const linuxRuntime = "/home/theo/.t3/runtime/versions/1.2.3/t3";
const linuxPlan = {
  program: [linuxRuntime, "__service-launcher"],
  baseDir: "/home/theo/.t3",
  logPath: "/home/theo/.t3/userdata/logs/boot-service.log",
  unitPath: "/home/theo/.config/systemd/user/t3code.service",
};

it("runs the pinned runtime's own executable as the systemd launcher", () => {
  const unit = BootService.renderBootServiceUnit(linuxPlan);

  expect(unit).toContain(`ExecStart=${linuxRuntime} __service-launcher`);
  expect(unit).toContain("KillMode=mixed");
  expect(unit).not.toContain("node");
});

it("reads the served T3 home back out of a rendered unit or plist", () => {
  const plan = (baseDir: string) => ({
    program: [`${baseDir}/runtime/versions/1.2.3/t3`, "__service-launcher"],
    baseDir,
    logPath: `${baseDir}/userdata/logs/boot-service.log`,
    unitPath: "/home/theo/.config/systemd/user/t3code.service",
  });

  expect(
    BootService.bootServiceBaseDirOf(BootService.renderBootServiceUnit(plan("/home/theo/.t3"))),
  ).toBe("/home/theo/.t3");
  // Spaces and specifiers are quoted and escaped on the way in.
  expect(
    BootService.bootServiceBaseDirOf(
      BootService.renderBootServiceUnit(plan("/home/theo/T3 Data/100%")),
    ),
  ).toBe("/home/theo/T3 Data/100%");
  expect(
    BootService.bootServiceBaseDirOf(
      BootService.renderBootServicePlist(plan("/Users/theo/a&b"), {
        homeDir: "/Users/theo",
        environmentPath: "/usr/bin",
      }),
    ),
  ).toBe("/Users/theo/a&b");
  expect(BootService.bootServiceBaseDirOf("[Service]\nExecStart=/x\n")).toBeUndefined();
});

it("survives the kernel OOM-killing a greedy agent child", () => {
  const unit = BootService.renderBootServiceUnit(linuxPlan);

  expect(unit).toContain("OOMPolicy=continue");
});

const macRuntime = "/Users/theo/.t3/runtime/versions/1.2.3/t3";
const macPlan = {
  program: [
    macRuntime,
    "__service-launcher",
    "--base-dir",
    "/Users/theo/.t3",
    "--log-path",
    "/Users/theo/.t3/userdata/logs/boot-service.log",
  ],
  baseDir: "/Users/theo/.t3",
  logPath: "/Users/theo/.t3/userdata/logs/boot-service.log",
  unitPath: "/Users/theo/Library/LaunchAgents/com.t3tools.t3code.service.plist",
};
const macInstallerPath =
  "/opt/homebrew/bin:/Users/theo/.npm-global/bin:/Users/theo/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin";
const macRenderOptions = { homeDir: "/Users/theo", environmentPath: macInstallerPath };

const windowsPlan = {
  program: [
    "C:\\Users\\Alex & Co\\.t3\\runtime\\versions\\1.2.3\\t3.exe",
    "__service-launcher",
    "--base-dir",
    "C:\\Users\\Alex & Co\\.t3",
    "--log-path",
    "C:\\Users\\Alex & Co\\.t3\\userdata\\logs\\boot-service.log",
  ],
  baseDir: "C:\\Users\\Alex & Co\\.t3",
  logPath: "C:\\Users\\Alex & Co\\.t3\\userdata\\logs\\boot-service.log",
  unitPath: "C:\\Users\\Alex & Co\\.t3\\runtime\\t3code-task.xml",
};

it("renders a per-user Windows task with no elevation or runtime limit", () => {
  const task = BootService.renderBootServiceTaskXml(windowsPlan, {
    homeDir: "C:\\Users\\Alex & Co",
    userId: "WORKSTATION\\alex",
  });

  expect(task.startsWith(`<?xml version="1.0" encoding="UTF-16"?>`)).toBe(true);
  expect(task).toContain("<LogonTrigger>\n      <Enabled>true</Enabled>");
  expect(task.match(/<Repetition>\n        <Interval>PT1M<\/Interval>/g)).toHaveLength(2);
  expect(task).toContain("<UserId>WORKSTATION\\alex</UserId>");
  expect(task).toContain("<LogonType>InteractiveToken</LogonType>");
  expect(task).toContain("<RunLevel>LeastPrivilege</RunLevel>");
  expect(task).toContain("<Hidden>true</Hidden>");
  expect(task).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
  expect(task).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
  expect(task).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
  expect(task).toContain(
    "<RestartOnFailure>\n      <Interval>PT1M</Interval>\n      <Count>255</Count>",
  );
  expect(task).toContain(
    "<Command>C:\\Users\\Alex &amp; Co\\.t3\\runtime\\versions\\1.2.3\\t3.exe</Command>",
  );
  expect(task).toContain(
    '"__service-launcher" "--base-dir" "C:\\Users\\Alex &amp; Co\\.t3" "--log-path" "C:\\Users\\Alex &amp; Co\\.t3\\userdata\\logs\\boot-service.log"',
  );
});

it("reads the Windows base directory back from explicit task arguments", () => {
  expect(
    BootService.bootServiceBaseDirOf(
      BootService.renderBootServiceTaskXml(windowsPlan, {
        homeDir: "C:\\Users\\Alex & Co",
        userId: "WORKSTATION\\alex",
      }),
    ),
  ).toBe(windowsPlan.baseDir);
});

it("resolves the native Windows profile and domain user without HOME", () => {
  expect(
    BootService.resolveBootServiceHomeDirectory({
      platform: "win32",
      configuredHome: "",
      environment: { USERPROFILE: "C:\\Users\\Alex" },
    }),
  ).toBe("C:\\Users\\Alex");
  expect(
    BootService.resolveBootServiceHomeDirectory({
      platform: "win32",
      configuredHome: "",
      environment: { HOMEDRIVE: "D:", HOMEPATH: "\\Profiles\\Alex" },
    }),
  ).toBe("D:\\Profiles\\Alex");
  expect(
    BootService.resolveWindowsTaskUserId({ USERDOMAIN: "WORKSTATION", USERNAME: "alex" }),
  ).toBe("WORKSTATION\\alex");
  expect(
    BootService.parseWhoamiUserSid(
      '"WORKSTATION\\alex","S-1-5-21-111111111-222222222-333333333-1001"\r\n',
    ),
  ).toBe("S-1-5-21-111111111-222222222-333333333-1001");
  expect(
    BootService.renderBootServiceTaskXml(windowsPlan, {
      homeDir: "C:\\Users\\Alex",
      userId: "WORK&STATION\\alex",
    }),
  ).toContain("<UserId>WORK&amp;STATION\\alex</UserId>");
});

it("passes explicit launcher paths on every service manager", () => {
  const unit = BootService.renderBootServiceUnit({
    program: [
      linuxRuntime,
      "__service-launcher",
      "--base-dir",
      "/home/theo/.t3",
      "--log-path",
      "/home/theo/.t3/userdata/logs/boot-service.log",
    ],
    baseDir: "/home/theo/.t3",
    logPath: "/home/theo/.t3/userdata/logs/boot-service.log",
    unitPath: "/home/theo/.config/systemd/user/t3code.service",
  });
  const plist = BootService.renderBootServicePlist(macPlan, macRenderOptions);

  expect(unit).toContain(
    "--base-dir /home/theo/.t3 --log-path /home/theo/.t3/userdata/logs/boot-service.log",
  );
  expect(plist).toContain("<string>--base-dir</string>\n    <string>/Users/theo/.t3</string>");
  expect(plist).toContain(
    "<string>--log-path</string>\n    <string>/Users/theo/.t3/userdata/logs/boot-service.log</string>",
  );
});

it("runs the pinned runtime's own executable as the launch agent", () => {
  const plist = BootService.renderBootServicePlist(macPlan, macRenderOptions);

  expect(plist).toContain(
    `  <array>\n    <string>${macRuntime}</string>\n    <string>__service-launcher</string>`,
  );
  expect(plist).not.toContain("node</string>");
});

it("preserves the installer's provider search path in the launch agent", () => {
  const plist = BootService.renderBootServicePlist(macPlan, macRenderOptions);

  expect(plist).toContain(`    <key>PATH</key>\n    <string>${macInstallerPath}</string>`);
});

it("restarts the launch agent on the systemd cadence", () => {
  const plist = BootService.renderBootServicePlist(macPlan, macRenderOptions);

  expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
  expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
  expect(plist).toContain("<key>ThrottleInterval</key>\n  <integer>5</integer>");
  expect(plist).toContain("<key>ExitTimeOut</key>\n  <integer>90</integer>");
});

it("appends both stdio streams to the boot service log", () => {
  const plist = BootService.renderBootServicePlist(macPlan, macRenderOptions);

  expect(plist).toContain(
    "<key>StandardOutPath</key>\n  <string>/Users/theo/.t3/userdata/logs/boot-service.log</string>",
  );
  expect(plist).toContain(
    "<key>StandardErrorPath</key>\n  <string>/Users/theo/.t3/userdata/logs/boot-service.log</string>",
  );
});

it("escapes XML in host paths", () => {
  const plist = BootService.renderBootServicePlist(
    { ...macPlan, baseDir: "/Users/theo/T3 & <Co>" },
    { homeDir: "/Users/theo", environmentPath: "/Users/theo/Tools & <Scripts>:/usr/bin" },
  );

  expect(plist).toContain("<string>/Users/theo/T3 &amp; &lt;Co&gt;</string>");
  expect(plist).toContain("<string>/Users/theo/Tools &amp; &lt;Scripts&gt;:/usr/bin</string>");
});

const makeHarness = Effect.fn("test.make_boot_service_harness")(function* (
  platform: NodeJS.Platform = "linux",
  installerPath = macInstallerPath,
  singleExecutable = false,
  legacyNpm = false,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-boot-service-test-" });
  const baseDir = path.join(home, ".t3");
  const statePath = path.join(baseDir, "runtime", "service-state.json");
  const launcherFileName = singleExecutable
    ? platform === "win32"
      ? "service-launcher.exe"
      : "service-launcher"
    : "service-launcher.mjs";
  const launcherSourcePath = path.join(home, launcherFileName);
  const launcherDigest = NodeCrypto.createHash("sha256")
    .update("fork-owned launcher\n")
    .digest("hex");
  const launcherPath = path.join(baseDir, "runtime", "launchers", launcherDigest, launcherFileName);
  yield* fs.writeFileString(launcherSourcePath, "fork-owned launcher\n");
  // A complete pinned runtime is already present, so install only validates
  // it and never downloads a release archive.
  const canonicalRuntime = pinnedRuntimePaths(path, baseDir, "1.2.3", platform);
  const runtime = legacyNpm
    ? {
        ...canonicalRuntime,
        entryPath: path.join(canonicalRuntime.versionDir, "node_modules", "t3", "dist", "bin.mjs"),
      }
    : canonicalRuntime;
  yield* fs.makeDirectory(path.dirname(runtime.entryPath), { recursive: true });
  yield* fs.writeFileString(runtime.entryPath, "#!/bin/sh\n");
  yield* fs.writeFileString(runtime.sentinelPath, "1.2.3\n");

  const commands: string[] = [];
  const timeouts = new Map<string, unknown>();
  let windowsTaskRegistered = false;
  const control: {
    acknowledgeStopRequest:
      | ((input: { readonly requestId: string; readonly acknowledgementPath: string }) => void)
      | undefined;
    failCommand: string | undefined;
    stateAfterStop?: string;
    linger: string;
    enabled: boolean;
    active: boolean;
  } = {
    acknowledgeStopRequest: undefined,
    failCommand: undefined,
    linger: "yes",
    enabled: true,
    active: true,
  };
  const runner = ProcessRunner.ProcessRunner.of({
    run: Effect.fn("test.run_boot_service_command")(function* (
      input: ProcessRunner.ProcessRunInput,
    ) {
      const command = `${input.command} ${input.args.join(" ")}`;
      commands.push(command);
      timeouts.set(command, input.timeout);
      const failed =
        command === control.failCommand ||
        (command.startsWith("schtasks.exe /Query ") && !windowsTaskRegistered);
      if (!failed && command.startsWith("schtasks.exe /Create ")) windowsTaskRegistered = true;
      if (!failed && command.startsWith("schtasks.exe /Delete ")) windowsTaskRegistered = false;
      if (!failed && command === "loginctl enable-linger --no-ask-password 501")
        control.linger = "yes";
      if (!failed && command === "systemctl --user enable t3code.service") control.enabled = true;
      if (!failed && command === "systemctl --user restart t3code.service") control.active = true;
      if (
        control.stateAfterStop !== undefined &&
        (command === "systemctl --user stop t3code.service" ||
          command.startsWith("launchctl bootout --wait "))
      ) {
        yield* fs.writeFileString(statePath, control.stateAfterStop).pipe(Effect.orDie);
      }
      return {
        stdout:
          input.command === "whoami.exe"
            ? '"WORKSTATION\\alex","S-1-5-21-111-222-333-1001"\n'
            : input.args.includes("--version")
              ? // The runtime under test reports the version of the directory it
                // was launched from, like the real executable.
                `t3 v${/versions\/([^/]+)\//.exec(`${input.command} ${input.args.join(" ")}`)?.[1] ?? "1.2.3"}\n`
              : input.command === "loginctl" && input.args[0] === "show-user"
                ? `${control.linger}\n`
                : input.args[1] === "is-enabled"
                  ? control.enabled
                    ? "enabled\n"
                    : "disabled\n"
                  : "",
        stderr: "",
        code: ChildProcessSpawner.ExitCode(
          failed || (input.args[1] === "is-active" && !control.active) ? 1 : 0,
        ),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      };
    }),
  });
  const makeService = (
    environmentPath: string | undefined = installerPath,
    cliVersion = "1.2.3",
    serviceBaseDir = baseDir,
  ) =>
    Effect.gen(function* () {
      // Every version the tests install is present and verified on disk, so
      // install never downloads.
      const canonicalPaths = pinnedRuntimePaths(path, serviceBaseDir, cliVersion, platform);
      const paths = legacyNpm
        ? {
            ...canonicalPaths,
            entryPath: path.join(
              canonicalPaths.versionDir,
              "node_modules",
              "t3",
              "dist",
              "bin.mjs",
            ),
          }
        : canonicalPaths;
      yield* fs.makeDirectory(path.dirname(paths.entryPath), { recursive: true });
      yield* fs.writeFileString(paths.entryPath, "#!/bin/sh\n");
      yield* fs.writeFileString(paths.sentinelPath, `${cliVersion}\n`);
      return yield* BootService.make({
        baseDir: serviceBaseDir,
        logsDir: path.join(serviceBaseDir, "userdata", "logs"),
        cliVersion,
        host: {
          execPath: singleExecutable ? "/usr/bin/t3" : "/usr/bin/node",
          singleExecutable,
          launcherSourcePath,
          stopAcknowledgementTimeout: Duration.zero,
          onStopRequestWritten: (stopRequest) => control.acknowledgeStopRequest?.(stopRequest),
        },
      });
    }).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, runner),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(HostProcessPlatform, platform),
          Layer.succeed(HostProcessEnvironment, {
            HOME: platform === "win32" ? "" : home,
            USERPROFILE: home,
            USERNAME: "alex",
            USERDOMAIN: "WORKSTATION",
            ...(environmentPath === "" ? {} : { PATH: environmentPath }),
          }),
          Layer.succeed(HostProcessUserId, 501),
          Layer.succeed(HostProcessExecutablePath, "/usr/bin/t3"),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("no release download expected")),
          ),
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                HOME: platform === "win32" ? "" : home,
                ...(environmentPath === undefined || environmentPath === ""
                  ? {}
                  : { PATH: environmentPath }),
              },
            }),
          ),
        ),
      ),
    );
  const service = yield* makeService();
  return {
    service,
    makeService,
    fs,
    home,
    baseDir,
    statePath,
    commands,
    timeouts,
    control,
    runtime,
    launcherPath,
    launcherSourcePath,
  };
});

it.layer(NodeServices.layer)("boot service install", (it) => {
  it.effect.each([
    { platform: "linux", singleExecutable: false },
    { platform: "darwin", singleExecutable: false },
    { platform: "win32", singleExecutable: false },
    { platform: "linux", singleExecutable: true },
    { platform: "darwin", singleExecutable: true },
    { platform: "win32", singleExecutable: true },
  ] as const)(
    "pins the fork launcher for $platform with SEA=$singleExecutable",
    ({ platform, singleExecutable }) =>
      Effect.gen(function* () {
        const { service, fs, baseDir, runtime, launcherPath } = yield* makeHarness(
          platform,
          macInstallerPath,
          singleExecutable,
        );
        const plan = yield* service.install();
        expect(plan.program).toEqual([
          ...(singleExecutable ? [launcherPath] : ["/usr/bin/node", launcherPath]),
          "--base-dir",
          baseDir,
          "--log-path",
          plan.logPath,
        ]);
        expect(plan.program).not.toContain("__service-launcher");
        expect(plan.program).not.toContain(runtime.entryPath);
        expect(yield* fs.readFileString(launcherPath)).toBe("fork-owned launcher\n");
        expect(yield* fs.readFileString(runtime.entryPath)).toBe("#!/bin/sh\n");
        expect((yield* service.status).current).toBe(true);
      }),
  );

  it.effect.each(["linux", "darwin", "win32"] as const)(
    "keeps a completed npm backend on its Node host for %s",
    (platform) =>
      Effect.gen(function* () {
        const { service, fs, runtime, commands } = yield* makeHarness(
          platform,
          macInstallerPath,
          false,
          true,
        );
        yield* service.install();
        expect(commands).toContain(`/usr/bin/node ${runtime.entryPath} --version`);
        expect(yield* fs.readFileString(runtime.entryPath)).toBe("#!/bin/sh\n");
        expect((yield* service.status).current).toBe(true);
      }),
  );

  it.effect("stages changed SEA launcher code without replacing the running image", () =>
    Effect.gen(function* () {
      const { service, fs, makeService, launcherPath, launcherSourcePath, commands } =
        yield* makeHarness("linux", macInstallerPath, true);
      yield* service.install();
      yield* fs.writeFileString(launcherSourcePath, "new fork launcher\n");
      const updated = yield* makeService();
      commands.length = 0;
      const plan = yield* updated.install({ start: false });
      expect(plan.program[0]).not.toBe(launcherPath);
      expect(yield* fs.readFileString(launcherPath)).toBe("fork-owned launcher\n");
      expect(yield* fs.readFileString(plan.program[0]!)).toBe("new fork launcher\n");
      expect(commands).not.toContain("systemctl --user stop t3code.service");
      expect(commands).not.toContain("systemctl --user restart t3code.service");
      expect((yield* updated.status).problems).toContain("restart-pending");
    }),
  );

  it.effect(
    "does not stop the installed service when this fork's launcher payload is missing",
    () =>
      Effect.gen(function* () {
        const { service, fs, makeService, launcherSourcePath, commands, statePath } =
          yield* makeHarness();
        yield* service.install();
        const previousState = yield* fs.readFileString(statePath);
        yield* fs.remove(launcherSourcePath);
        const brokenInstaller = yield* makeService();
        commands.length = 0;
        expect((yield* brokenInstaller.install().pipe(Effect.flip))._tag).toBe(
          "BootServiceInstallError",
        );
        expect(commands).not.toContain("systemctl --user stop t3code.service");
        expect(yield* fs.readFileString(statePath)).toBe(previousState);
      }),
  );

  it.effect(
    "fails before installing files or validating a runtime when lingering needs an administrator",
    () =>
      Effect.gen(function* () {
        const { service, fs, statePath, commands, control, runtime } = yield* makeHarness();
        const before = yield* service.status;
        control.linger = "no";
        control.failCommand = "loginctl enable-linger --no-ask-password 501";
        yield* fs.remove(runtime.sentinelPath);

        const error = yield* service.install().pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "BootServicePrerequisiteError",
          problem: "linger-disabled",
        });
        expect(error.message).toContain('sudo loginctl enable-linger "$(id -un)"');
        expect(error.message).toContain("last login session ends");
        expect(yield* fs.exists(before.unitPath)).toBe(false);
        expect(yield* fs.exists(statePath)).toBe(false);
        expect(commands.some((command) => command.includes("--version"))).toBe(false);
        expect(
          commands.some(
            (command) => command.includes("daemon-reload") || command.includes("restart"),
          ),
        ).toBe(false);
        expect(yield* fs.readFileString(before.logPath)).toContain("[linger-disabled]");
      }),
  );

  it.effect(
    "detects a partial install and preserves the running service when repair lacks permission",
    () =>
      Effect.gen(function* () {
        const { service, fs, statePath, commands, control } = yield* makeHarness();
        const plan = yield* service.install();
        const before = yield* fs.readFileString(statePath);
        const unit = yield* fs.readFileString(plan.unitPath);
        control.linger = "no";
        control.failCommand = "loginctl enable-linger --no-ask-password 501";

        expect(yield* service.status).toMatchObject({
          current: false,
          problems: ["linger-disabled"],
        });
        commands.length = 0;
        expect((yield* service.install().pipe(Effect.flip))._tag).toBe(
          "BootServicePrerequisiteError",
        );
        expect(yield* fs.readFileString(statePath)).toBe(before);
        expect(yield* fs.readFileString(plan.unitPath)).toBe(unit);
        expect(commands).not.toContain("systemctl --user stop t3code.service");
      }),
  );

  it.effect("enables lingering before installing and repairs stopped or disabled services", () =>
    Effect.gen(function* () {
      const { service, commands, control } = yield* makeHarness();
      control.linger = "no";
      yield* service.install();
      expect(control.linger).toBe("yes");
      expect(commands.indexOf("loginctl enable-linger --no-ask-password 501")).toBeLessThan(
        commands.indexOf("systemctl --user daemon-reload"),
      );

      control.enabled = false;
      control.active = false;
      expect(yield* service.status).toMatchObject({
        current: false,
        problems: ["service-disabled", "service-stopped"],
      });
      yield* service.install();
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect.each([
    { command: "systemctl --user show-environment", problem: "user-manager-unavailable" },
    { command: "loginctl show-user 501 --property=Linger --value", problem: "linger-unavailable" },
  ])("reports failed prerequisite probes without installing: $command", ({ command, problem }) =>
    Effect.gen(function* () {
      const { service, fs, statePath, control } = yield* makeHarness();
      control.failCommand = command;
      expect(yield* service.install().pipe(Effect.flip)).toMatchObject({
        _tag: "BootServicePrerequisiteError",
        problem,
      });
      expect(yield* fs.exists(statePath)).toBe(false);
    }),
  );

  it.effect("installs, reports current state, and uninstalls", () =>
    Effect.gen(function* () {
      const { service, fs, baseDir, statePath, timeouts, launcherPath } = yield* makeHarness();
      const plan = yield* service.install();

      expect(parseServiceState(yield* fs.readFileString(statePath))).toEqual({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.2.3",
      });
      expect(plan.program).toEqual([
        "/usr/bin/node",
        launcherPath,
        "--base-dir",
        baseDir,
        "--log-path",
        plan.logPath,
      ]);
      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        `ExecStart=/usr/bin/node ${launcherPath}`,
      );
      expect(yield* service.status).toMatchObject({
        current: true,
        installedVersion: "1.2.3",
      });
      // @effect-diagnostics-next-line preferSchemaOverJson:off - fixed launcher-owned test document.
      const pendingState = JSON.stringify({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.2.3",
        update: {
          id: "u",
          fromVersion: "1.2.3",
          targetVersion: "1.2.4",
          dbPath: "/tmp/state.sqlite",
          status: "pending",
        },
      });
      yield* fs.writeFileString(statePath, pendingState);
      expect((yield* service.status).current).toBe(false);
      expect(yield* service.uninstall).toBe(true);
      expect((yield* service.status).installed).toBe(false);
      // The stop can block up to systemd's 90s TimeoutStopSec; the runner's
      // 60s default would cancel it mid-shutdown.
      expect(timeouts.get("systemctl --user disable --now t3code.service")).toEqual(
        Duration.seconds(120),
      );
    }),
  );

  it.effect.each(["linux", "darwin"] as const)(
    "reports the installed version across launcher protocols on %s",
    (platform) =>
      Effect.gen(function* () {
        const { service, fs, statePath } = yield* makeHarness(platform);
        yield* service.install();

        for (const protocol of [SERVICE_LAUNCHER_PROTOCOL - 1, SERVICE_LAUNCHER_PROTOCOL + 1]) {
          yield* fs.writeFileString(
            statePath,
            `{"protocol":${protocol},"activeVersion":"1.2.4-nightly.1","update":{"status":"unknown"}}`,
          );
          expect(yield* service.status).toMatchObject({
            current: false,
            installedVersion: "1.2.4-nightly.1",
          });
        }
      }),
  );

  it.effect("reports an unknown version for invalid service state", () =>
    Effect.gen(function* () {
      const { service, fs, statePath } = yield* makeHarness();
      yield* service.install();

      for (const stateText of [
        "{",
        '{"activeVersion":"latest"}',
        '{"activeVersion":"1.2"}',
        '{"activeVersion":123}',
      ]) {
        yield* fs.writeFileString(statePath, stateText);
        const status = yield* service.status;
        expect(status.current).toBe(false);
        expect(status.installedVersion).toBeUndefined();
      }
    }),
  );

  it.effect.each(["linux", "darwin"] as const)(
    "preserves a newer version that finishes updating during stop on %s",
    (platform) =>
      Effect.gen(function* () {
        const { service, fs, statePath, commands, control } = yield* makeHarness(platform);
        const plan = yield* service.install();
        const unit = yield* fs.readFileString(plan.unitPath);
        control.stateAfterStop = `{"protocol":${SERVICE_LAUNCHER_PROTOCOL + 1},"activeVersion":"1.2.4"}`;
        commands.length = 0;

        const error = yield* service.install().pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "BootServiceDowngradeRefusedError",
          installedVersion: "1.2.4",
          targetVersion: "1.2.3",
        });
        expect(yield* fs.readFileString(statePath)).toBe(control.stateAfterStop);
        expect(yield* fs.readFileString(plan.unitPath)).toBe(unit);
        expect(
          commands.filter(
            (command) =>
              command.startsWith(platform === "linux" ? "systemctl " : "launchctl ") &&
              !command.includes("show-environment"),
          ),
        ).toEqual(
          platform === "linux"
            ? ["systemctl --user stop t3code.service", "systemctl --user restart t3code.service"]
            : [
                "launchctl bootout --wait gui/501/com.t3tools.t3code.service",
                `launchctl bootstrap gui/501 ${plan.unitPath}`,
              ],
        );
      }),
  );

  it.effect("allows an explicit downgrade", () =>
    Effect.gen(function* () {
      const { service, fs, statePath } = yield* makeHarness();
      yield* service.install();
      yield* fs.writeFileString(
        statePath,
        `{"protocol":${SERVICE_LAUNCHER_PROTOCOL},"activeVersion":"1.2.4"}`,
      );

      yield* service.install({ allowDowngrade: true });

      expect(parseServiceState(yield* fs.readFileString(statePath))?.activeVersion).toBe("1.2.3");
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("repairs versions with equal SemVer precedence without an override", () =>
    Effect.gen(function* () {
      const { service, fs, statePath } = yield* makeHarness();
      yield* service.install();
      yield* fs.writeFileString(
        statePath,
        `{"protocol":${SERVICE_LAUNCHER_PROTOCOL},"activeVersion":"1.2.3+previous-build"}`,
      );

      yield* service.install();

      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("install with start=false rewrites the files and marks a restart pending", () =>
    Effect.gen(function* () {
      const { service, fs, statePath, commands, makeService } = yield* makeHarness();
      yield* service.install();
      commands.length = 0;

      const newer = yield* makeService(undefined, "1.2.4");
      const plan = yield* newer.install({ start: false });

      expect(parseServiceState(yield* fs.readFileString(statePath))).toEqual({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.2.4",
      });
      expect(yield* fs.readFileString(plan.unitPath)).toContain("service-launcher.mjs");
      expect(
        commands.filter(
          (command) => command.startsWith("systemctl ") && !command.includes("show-environment"),
        ),
      ).toEqual([]);
      // The files say 1.2.4 but the process is still 1.2.3: not current, and
      // the reason is named so `t3 service status` can point at restart.
      const status = yield* newer.status;
      expect(status.current).toBe(false);
      expect(status.problems).toContain("restart-pending");

      commands.length = 0;
      expect(yield* newer.restart).toBe(true);
      expect((yield* newer.status).problems).not.toContain("restart-pending");
      expect((yield* newer.status).current).toBe(true);
    }),
  );

  it.effect("defers Windows task activation with start=false and repairs it on restart", () =>
    Effect.gen(function* () {
      const { service, makeService, commands } = yield* makeHarness("win32");
      yield* service.install();
      const newer = yield* makeService(undefined, "1.2.4");
      commands.length = 0;

      yield* newer.install({ start: false });

      expect(commands.some((command) => /^schtasks.exe \/(?:End|Run|Create) /.test(command))).toBe(
        false,
      );
      expect((yield* newer.status).problems).toContain("restart-pending");
      expect(yield* newer.restart).toBe(true);
      expect((yield* newer.status).current).toBe(true);
    }),
  );

  it.effect("install with start=false keeps the marker when a later write fails", () =>
    Effect.gen(function* () {
      const { service, fs, statePath, makeService } = yield* makeHarness();
      const path = yield* Path.Path;
      yield* service.install();
      const newer = yield* makeService(undefined, "1.2.4");
      // A non-empty directory in the unit's place: it still counts as an
      // installed unit, and the rename that writes the new unit fails.
      const unitPath = (yield* service.status).unitPath;
      yield* fs.remove(unitPath);
      yield* fs.makeDirectory(unitPath);
      yield* fs.writeFileString(path.join(unitPath, "occupied"), "");

      const error = yield* newer.install({ start: false }).pipe(Effect.flip);
      expect(error._tag).toBe("BootServiceInstallError");
      expect(
        yield* fs.exists(path.join(path.dirname(statePath), SERVICE_RESTART_PENDING_FILE)),
      ).toBe(true);
    }),
  );

  it.effect("install with start=false refuses while a remote update is pending", () =>
    Effect.gen(function* () {
      const { service, fs, statePath } = yield* makeHarness();
      yield* service.install();
      // @effect-diagnostics-next-line preferSchemaOverJson:off - fixed launcher-owned test document.
      const pendingState = JSON.stringify({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.2.3",
        update: {
          id: "u",
          fromVersion: "1.2.3",
          targetVersion: "1.2.4",
          dbPath: "/tmp/state.sqlite",
          status: "pending",
        },
      });
      yield* fs.writeFileString(statePath, pendingState);

      const error = yield* service.install({ start: false }).pipe(Effect.flip);
      expect(error._tag).toBe("BootServiceUpdatePendingError");
      expect(yield* fs.readFileString(statePath)).toBe(pendingState);
    }),
  );

  it.effect("restart stops and starts an installed service, and is a no-op otherwise", () =>
    Effect.gen(function* () {
      const { service, commands } = yield* makeHarness();
      expect(yield* service.restart).toBe(false);
      yield* service.install();
      commands.length = 0;

      expect(yield* service.restart).toBe(true);
      expect(
        commands.filter(
          (command) => command.startsWith("systemctl ") && !command.includes("show-environment"),
        ),
      ).toEqual([
        "systemctl --user stop t3code.service",
        "systemctl --user daemon-reload",
        "systemctl --user enable t3code.service",
        "systemctl --user restart t3code.service",
      ]);
    }),
  );

  it.effect("restart leaves a service that serves another T3 home alone", () =>
    Effect.gen(function* () {
      const { service, fs, commands, makeService } = yield* makeHarness();
      yield* service.install();
      commands.length = 0;
      const path = yield* Path.Path;
      const otherHome = yield* fs.makeTempDirectoryScoped({ prefix: "t3-other-home-" });

      const other = yield* makeService(undefined, "1.2.3", path.join(otherHome, ".t3"));
      expect(yield* other.restart).toBe(false);
      expect(commands.filter((command) => command.startsWith("systemctl "))).toEqual([]);
    }),
  );

  it.effect("restart brings the service back when activation fails", () =>
    Effect.gen(function* () {
      const { service, commands, control } = yield* makeHarness();
      yield* service.install();
      commands.length = 0;
      control.failCommand = "systemctl --user daemon-reload";

      const error = yield* service.restart.pipe(Effect.flip);
      expect(error._tag).toBe("BootServiceCommandError");
      expect(
        commands.filter(
          (command) => command.startsWith("systemctl ") && !command.includes("show-environment"),
        ),
      ).toEqual([
        "systemctl --user stop t3code.service",
        "systemctl --user daemon-reload",
        "systemctl --user restart t3code.service",
      ]);
    }),
  );

  it.effect("restarts an installed service when repair fails", () =>
    Effect.gen(function* () {
      const { service, commands, control } = yield* makeHarness();
      yield* service.install();
      commands.length = 0;
      control.failCommand = "systemctl --user daemon-reload";

      const error = yield* service.install().pipe(Effect.flip);
      expect(error._tag).toBe("BootServiceCommandError");
      expect(
        commands.filter(
          (command) => command.startsWith("systemctl ") && !command.includes("show-environment"),
        ),
      ).toEqual([
        "systemctl --user stop t3code.service",
        "systemctl --user daemon-reload",
        "systemctl --user restart t3code.service",
      ]);
    }),
  );

  it.effect("restarts without overwriting a pending remote update", () =>
    Effect.gen(function* () {
      const { service, fs, statePath, commands } = yield* makeHarness();
      yield* service.install();
      // @effect-diagnostics-next-line preferSchemaOverJson:off - fixed launcher-owned test document.
      const pendingState = JSON.stringify({
        protocol: SERVICE_LAUNCHER_PROTOCOL - 1,
        activeVersion: "1.2.3",
        update: {
          id: "remote-update",
          fromVersion: "1.2.3",
          targetVersion: "1.2.4",
          status: "pending",
        },
      });
      yield* fs.writeFileString(statePath, pendingState);
      for (const allowDowngrade of [false, true]) {
        commands.length = 0;

        expect((yield* service.install({ allowDowngrade }).pipe(Effect.flip))._tag).toBe(
          "BootServiceUpdatePendingError",
        );
        expect(serviceStateHasPendingUpdate(yield* fs.readFileString(statePath))).toBe(true);
        expect(
          commands.filter(
            (command) => command.startsWith("systemctl ") && !command.includes("show-environment"),
          ),
        ).toEqual([
          "systemctl --user stop t3code.service",
          "systemctl --user restart t3code.service",
        ]);
      }
    }),
  );

  it.effect("installs, verifies, repairs, and uninstalls a per-user Windows task", () =>
    Effect.gen(function* () {
      const { service, home, commands, control } = yield* makeHarness("win32");
      const plan = yield* service.install();

      const taskFile = NodeFS.readFileSync(plan.unitPath);
      expect([...taskFile.subarray(0, 2)]).toEqual([0xff, 0xfe]);
      const taskXml = taskFile.toString("utf16le");
      expect(plan.unitPath.endsWith("runtime/t3code-task.xml")).toBe(true);
      expect(taskXml).toContain(`<WorkingDirectory>${home}</WorkingDirectory>`);
      expect(taskXml).toContain("<UserId>S-1-5-21-111-222-333-1001</UserId>");
      expect((yield* service.status).current).toBe(true);
      expect(commands).toContain(
        `schtasks.exe /Create /TN ${BootService.BOOT_SERVICE_WINDOWS_TASK_NAME} /XML ${plan.unitPath} /F`,
      );
      expect(commands).toContain(
        `schtasks.exe /Run /TN ${BootService.BOOT_SERVICE_WINDOWS_TASK_NAME}`,
      );
      expect(commands.some((command) => command.includes("/RL HIGHEST"))).toBe(false);
      expect(commands.some((command) => command.includes("/RU SYSTEM"))).toBe(false);

      const query = `schtasks.exe /Query /TN ${BootService.BOOT_SERVICE_WINDOWS_TASK_NAME} /XML`;
      control.failCommand = query;
      expect((yield* service.status).installed).toBe(false);
      control.failCommand = undefined;

      yield* service.install();
      expect(commands).toContain(
        `schtasks.exe /End /TN ${BootService.BOOT_SERVICE_WINDOWS_TASK_NAME}`,
      );
      expect(yield* service.uninstall).toBe(true);
      expect(commands).toContain(
        `schtasks.exe /Delete /TN ${BootService.BOOT_SERVICE_WINDOWS_TASK_NAME} /F`,
      );
    }),
  );

  it.effect("force kills only the acknowledged launcher tree after the stop timeout", () =>
    Effect.gen(function* () {
      const { service, fs, commands, control } = yield* makeHarness("win32");
      const plan = yield* service.install();
      commands.length = 0;
      control.acknowledgeStopRequest = ({ requestId, acknowledgementPath }) =>
        NodeFS.writeFileSync(
          acknowledgementPath,
          JSON.stringify({
            protocol: SERVICE_STOP_PROTOCOL,
            id: requestId,
            pid: 4242,
            status: "received",
          }),
        );

      yield* service.install();

      expect(commands).toContain(
        `schtasks.exe /End /TN ${BootService.BOOT_SERVICE_WINDOWS_TASK_NAME}`,
      );
      expect(commands).toContain("taskkill.exe /PID 4242 /T /F");
      expect(yield* fs.readFileString(plan.logPath)).toContain(
        "Graceful Windows service shutdown timed out",
      );
    }),
  );

  it.effect("installs, reports current state, and uninstalls on macOS", () =>
    Effect.gen(function* () {
      const { service, fs, statePath, commands, timeouts, launcherPath } =
        yield* makeHarness("darwin");
      const path = yield* Path.Path;
      const plan = yield* service.install();

      expect(
        plan.unitPath.endsWith(
          path.join("Library", "LaunchAgents", "com.t3tools.t3code.service.plist"),
        ),
      ).toBe(true);
      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        `    <key>PATH</key>\n    <string>${macInstallerPath}:/usr/local/bin:/usr/sbin:/sbin</string>`,
      );
      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        `    <key>PATH</key>\n    <string>${macInstallerPath}:/usr/local/bin:/usr/sbin:/sbin</string>`,
      );
      expect(parseServiceState(yield* fs.readFileString(statePath))).toEqual({
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "1.2.3",
      });
      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        `    <string>/usr/bin/node</string>\n    <string>${launcherPath}</string>`,
      );
      expect(yield* service.status).toMatchObject({
        current: true,
        installedVersion: "1.2.3",
      });
      expect(yield* service.uninstall).toBe(true);
      expect((yield* service.status).installed).toBe(false);
      expect(commands.some((command) => command.startsWith("systemctl "))).toBe(false);
      // A bootout can block up to the plist's 90s ExitTimeOut; the runner's
      // 60s default would cancel it and let bootstrap race a loaded job.
      expect(timeouts.get("launchctl bootout --wait gui/501/com.t3tools.t3code.service")).toEqual(
        Duration.seconds(120),
      );
    }),
  );

  it.effect("restarts the launch agent when repair fails", () =>
    Effect.gen(function* () {
      const { service, commands, control } = yield* makeHarness("darwin");
      yield* service.install();
      const plistPath = (yield* service.status).unitPath;
      commands.length = 0;
      control.failCommand = `launchctl bootstrap gui/501 ${plistPath}`;

      const error = yield* service.install().pipe(Effect.flip);
      expect(error._tag).toBe("BootServiceCommandError");
      expect(commands.filter((command) => command.startsWith("launchctl "))).toEqual([
        "launchctl bootout --wait gui/501/com.t3tools.t3code.service",
        "launchctl enable gui/501/com.t3tools.t3code.service",
        `launchctl bootstrap gui/501 ${plistPath}`,
        `launchctl bootstrap gui/501 ${plistPath}`,
      ]);
    }),
  );

  it.effect("reconstructs a launch agent search path when the installer has no PATH", () =>
    Effect.gen(function* () {
      const { service, fs } = yield* makeHarness("darwin", "");
      const plan = yield* service.install();

      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        "    <key>PATH</key>\n    <string>/usr/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/sbin:/sbin</string>",
      );
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("adds missing provider directories to a minimal installer PATH", () =>
    Effect.gen(function* () {
      const { service, fs } = yield* makeHarness("darwin", "/usr/bin:/bin");
      const plan = yield* service.install();

      expect(yield* fs.readFileString(plan.unitPath)).toContain(
        "    <key>PATH</key>\n    <string>/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/sbin</string>",
      );
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("keeps an installed launch agent current when the process PATH changes", () =>
    Effect.gen(function* () {
      const { service, makeService } = yield* makeHarness("darwin");
      yield* service.install();

      const restartedService = yield* makeService("/usr/local/bin:/usr/bin:/bin");
      expect((yield* restartedService.status).current).toBe(true);
    }),
  );

  it.effect("drops PATH directories that cannot be represented in a launch agent plist", () =>
    Effect.gen(function* () {
      const { service, fs } = yield* makeHarness(
        "darwin",
        "/opt/homebrew/bin:/Users/theo/\u0001invalid:/usr/bin",
      );
      const plan = yield* service.install();
      const plist = yield* fs.readFileString(plan.unitPath);

      expect(plist).toContain(
        "    <key>PATH</key>\n    <string>/opt/homebrew/bin:/usr/bin:/usr/local/bin:/bin:/usr/sbin:/sbin</string>",
      );
      expect(plist).not.toContain("\u0001");
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("ignores a bootout for an agent that is not loaded", () =>
    Effect.gen(function* () {
      const { service, control } = yield* makeHarness("darwin");
      yield* service.install();
      control.failCommand = "launchctl bootout --wait gui/501/com.t3tools.t3code.service";

      yield* service.install();
      expect((yield* service.status).current).toBe(true);
    }),
  );

  it.effect("restarts without overwriting a pending remote update on macOS", () =>
    Effect.gen(function* () {
      const { service, fs, statePath, commands } = yield* makeHarness("darwin");
      yield* service.install();
      const plistPath = (yield* service.status).unitPath;
      // @effect-diagnostics-next-line preferSchemaOverJson:off - fixed launcher-owned test document.
      const pendingState = JSON.stringify({
        protocol: SERVICE_LAUNCHER_PROTOCOL - 1,
        activeVersion: "1.2.3",
        update: {
          id: "remote-update",
          fromVersion: "1.2.3",
          targetVersion: "1.2.4",
          status: "pending",
        },
      });
      yield* fs.writeFileString(statePath, pendingState);
      for (const allowDowngrade of [false, true]) {
        commands.length = 0;

        expect((yield* service.install({ allowDowngrade }).pipe(Effect.flip))._tag).toBe(
          "BootServiceUpdatePendingError",
        );
        expect(serviceStateHasPendingUpdate(yield* fs.readFileString(statePath))).toBe(true);
        expect(commands.filter((command) => command.startsWith("launchctl "))).toEqual([
          "launchctl bootout --wait gui/501/com.t3tools.t3code.service",
          `launchctl bootstrap gui/501 ${plistPath}`,
        ]);
      }
    }),
  );
});
