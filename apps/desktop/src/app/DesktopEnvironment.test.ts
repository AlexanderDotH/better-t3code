import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) => DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(layerEnvironment(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("uses the packaged Windows server sidecar as the backend root", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        appPath: "/install/resources/app.asar",
        resourcesPath: "/install/resources",
      });

      assert.equal(environment.appRoot, "/install/resources/app.asar");
      assert.equal(environment.serverRoot, "/install/resources/server.asar");
      assert.equal(
        environment.backendEntryPath,
        "/install/resources/server.asar/apps/server/dist/bin.mjs",
      );
      assert.equal(
        environment.clientAssetsDir,
        "/install/resources/server.asar/apps/server/dist/client",
      );
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.stateDir, "/Users/alice/.t3/dev");
      assert.equal(production.stateDir, "/Users/alice/.t3/userdata");
    }),
  );

  it.effect("uses a configured app user model id override", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          T3CODE_DESKTOP_APP_USER_MODEL_ID: " com.t3tools.t3code.dev.local ",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
        },
      );

      assert.equal(environment.appUserModelId, "com.t3tools.t3code.dev.local");
    }),
  );

  it.effect("uses configured side-by-side desktop identity overrides", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {
          platform: "linux",
          isPackaged: true,
          appPath: "/opt/t3code-local/resources/app.asar",
          resourcesPath: "/opt/t3code-local/resources",
        },
        {
          T3CODE_DESKTOP_APP_USER_MODEL_ID: " com.t3tools.t3code.local ",
          T3CODE_DESKTOP_DISPLAY_NAME: " T3 Code Local ",
          T3CODE_DESKTOP_USER_DATA_DIR_NAME: " t3code-local ",
          T3CODE_DESKTOP_LEGACY_USER_DATA_DIR_NAME: " T3 Code Local ",
          T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME: " t3code-local.desktop ",
          T3CODE_DESKTOP_LINUX_WM_CLASS: " t3code-local ",
        },
      );

      assert.equal(environment.appUserModelId, "com.t3tools.t3code.local");
      assert.equal(environment.displayName, "T3 Code Local");
      assert.equal(environment.branding.displayName, "T3 Code Local");
      assert.equal(environment.userDataDirName, "t3code-local");
      assert.equal(environment.legacyUserDataDirName, "T3 Code Local");
      assert.equal(environment.linuxDesktopEntryName, "t3code-local.desktop");
      assert.equal(environment.linuxWmClass, "t3code-local");
    }),
  );

  it.effect("resolves picker defaults without nullish sentinels", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment();

      assert.deepEqual(environment.resolvePickFolderDefaultPath(null), Option.none());
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: " " }),
        Option.none(),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~" }),
        Option.some("/Users/alice"),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~/project" }),
        Option.some("/Users/alice/project"),
      );
    }),
  );

  it.effect("resolves packaged app root from backend bundle candidates", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const tempRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-desktop-environment-",
      });
      const resourcesPath = `${tempRoot}/resources`;
      const appPath = `${tempRoot}/app.asar`;
      const packagedAppRoot = `${resourcesPath}/app`;

      yield* fileSystem.makeDirectory(`${packagedAppRoot}/apps/server/dist`, {
        recursive: true,
      });
      yield* fileSystem.writeFileString(
        `${packagedAppRoot}/apps/server/dist/bin.mjs`,
        `export {};`,
      );

      const environment = yield* makeEnvironment({
        dirname: `${tempRoot}/apps/desktop/dist-electron`,
        appPath,
        isPackaged: true,
        resourcesPath,
      });

      assert.equal(environment.appRoot, packagedAppRoot);
      assert.equal(environment.backendEntryPath, `${packagedAppRoot}/apps/server/dist/bin.mjs`);
      assert.equal(environment.appUpdateYmlPath, `${resourcesPath}/app-update.yml`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps app.asar as the packaged app root when backend files are unpacked", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const tempRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-desktop-environment-",
      });
      const resourcesPath = `${tempRoot}/resources`;
      const appPath = `${resourcesPath}/app.asar`;
      const asarAppRoot = appPath;
      const unpackedAppRoot = `${resourcesPath}/app.asar.unpacked`;

      for (const appRoot of [asarAppRoot, unpackedAppRoot]) {
        yield* fileSystem.makeDirectory(`${appRoot}/apps/server/dist`, {
          recursive: true,
        });
        yield* fileSystem.writeFileString(`${appRoot}/apps/server/dist/bin.mjs`, `export {};`);
      }

      const environment = yield* makeEnvironment({
        dirname: `${tempRoot}/apps/desktop/dist-electron`,
        appPath,
        isPackaged: true,
        resourcesPath,
      });

      assert.equal(environment.appRoot, asarAppRoot);
      assert.equal(environment.backendEntryPath, `${asarAppRoot}/apps/server/dist/bin.mjs`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
