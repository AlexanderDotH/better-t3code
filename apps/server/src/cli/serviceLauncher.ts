import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/cli";

import { main as runServiceLauncher } from "../serviceLauncher.ts";

/** The launcher must stop its child before exiting; `runMain` would interrupt that shutdown. */
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
