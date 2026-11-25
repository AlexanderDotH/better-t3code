import * as NodeServices from "@effect/platform-node/NodeServices";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { it as effectIt } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { describe, expect, it } from "vite-plus/test";

import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import * as OpenCodeServerLedger from "./OpenCodeServerLedger.ts";

describe("runOpenCodeCommand", () => {
  effectIt.live.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "finds the native installation when PATH has no executable OpenCode",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-opencode-home-" });
        const nativeBin = path.join(home, ".opencode", "bin");
        const pathBin = path.join(home, "path-bin");
        const pathBinary = path.join(pathBin, "opencode");
        const nativeBinary = path.join(nativeBin, "opencode");
        yield* fs.makeDirectory(nativeBin, { recursive: true });
        yield* fs.makeDirectory(pathBin);
        yield* fs.writeFileString(nativeBinary, "#!/bin/sh\nprintf 'opencode v2.4.1\\n'\n", {
          mode: 0o755,
        });
        yield* fs.writeFileString(pathBinary, "#!/bin/sh\nprintf 'opencode v1.14.19\\n'\n", {
          mode: 0o644,
        });

        const runtime = yield* OpenCodeRuntime.OpenCodeRuntime;
        const runVersion = (binaryPath: string) =>
          runtime
            .runOpenCodeCommand({ binaryPath, args: ["--version"], environment: { PATH: pathBin } })
            .pipe(Effect.provideService(HostProcess.HomeDirectory, home));

        expect((yield* runVersion("opencode")).stdout).toBe("opencode v2.4.1\n");
        yield* fs.chmod(pathBinary, 0o755);
        expect((yield* runVersion("opencode")).stdout).toBe("opencode v1.14.19\n");
        expect((yield* runVersion(nativeBinary)).stdout).toBe("opencode v2.4.1\n");
      }).pipe(
        Effect.scoped,
        Effect.provide(
          OpenCodeRuntime.layer.pipe(
            Layer.provide(OpenCodeServerLedger.layerTest),
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      ),
  );
});

describe("resolveOpenCodeServerPassword", () => {
  it("uses the settings password when local settings and environment differ", () => {
    expect(
      OpenCodeRuntime.resolveOpenCodeServerPassword(
        {
          external: false,
          serverPassword: "settings-password",
          environment: { OPENCODE_SERVER_PASSWORD: "environment-password" },
        },
        {},
      ),
    ).toBe("settings-password");
  });

  it("does not send an inherited local password to an external server", () => {
    expect(
      OpenCodeRuntime.resolveOpenCodeServerPassword(
        { external: true, environment: { OPENCODE_SERVER_PASSWORD: "local-secret" } },
        { OPENCODE_SERVER_PASSWORD: "inherited-secret" },
      ),
    ).toBeUndefined();
  });
});

function makeHealthClient(
  result: (options?: { readonly signal?: AbortSignal }) => Promise<unknown>,
): OpencodeClient {
  return {
    global: {
      health: result,
    },
  } as unknown as OpencodeClient;
}

describe("verifyOpenCodeServerVersion", () => {
  effectIt.effect("rejects a server below the supported version", () =>
    Effect.gen(function* () {
      const error = yield* OpenCodeRuntime.verifyOpenCodeServerVersion(
        makeHealthClient(() => Promise.resolve({ data: { healthy: true, version: "1.14.18" } })),
      ).pipe(Effect.flip);
      expect(error).toBeInstanceOf(OpenCodeRuntime.OpenCodeRuntimeError);
      expect(error.detail).toContain("v1.14.18 is too old");
    }),
  );
});
