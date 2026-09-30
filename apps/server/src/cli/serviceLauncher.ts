import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import { main as runServiceLauncher } from "../serviceLauncher.ts";

/**
 * Hosts the service launcher inside the CLI executable. The service manager
 * runs `t3 __service-launcher` and the launcher spawns the server from the
 * same executable, so the machine needs no Node to run either.
 *
 * The launcher owns SIGTERM handling and the process lifetime: it must finish
 * stopping its child before the process exits, so it runs detached from the
 * CLI's fiber rather than under `runMain`, whose signal handler would
 * interrupt the fiber and exit while the child is still being terminated.
 */
export const serviceLauncherCommand = Command.make("__service-launcher", {
  baseDir: Flag.String("base-dir").pipe(Flag.optional),
  logPath: Flag.String("log-path").pipe(Flag.optional),
}).pipe(
  Command.unlisted,
  Command.withHandler((options) =>
    Effect.sync(() => {
      const args = [
        ...Option.match(options.baseDir, {
          onNone: () => [],
          onSome: (value) => ["--base-dir", value],
        }),
        ...Option.match(options.logPath, {
          onNone: () => [],
          onSome: (value) => ["--log-path", value],
        }),
      ];
      runServiceLauncher(args).catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        process.stderr.write(`[service-launcher] ${error.message}\n`);
        process.exitCode = 1;
      });
    }),
  ),
);
