// @effect-diagnostics nodeBuiltinImport:off - Stream descriptors/results through an owned compiler process; project code is never executed.
// @effect-diagnostics globalTimers:off - Idle deadlines terminate only the captured helper process.
import * as NodeChildProcess from "node:child_process";
import type { ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { resolveFilesystemAsset } from "./assets.ts";
import { resolveAnalysisHelper } from "./nativeSemantic.ts";
import { CompilerMessage, type StreamingSemanticInput } from "./streamingTypes.ts";

const decodeLine = Schema.decodeUnknownSync(Schema.fromJsonString(CompilerMessage));
const MAX_RECORD_BYTES = 2 * 1024 * 1024;

export async function* nativeCompilerMessages(
  input: StreamingSemanticInput,
  language: "csharp" | "java",
  files: AsyncIterable<ProjectSourceFileV1>,
): AsyncGenerator<CompilerMessage> {
  const override = input.helperPaths?.[language === "csharp" ? "dotnet" : "java"];
  const helper = override
    ? resolveFilesystemAsset(override)
    : await resolveAnalysisHelper(language);
  if (!helper)
    throw new Error(`${language === "csharp" ? "Roslyn" : "JDT"} helper is not packaged.`);
  input.signal?.throwIfAborted();
  const child = NodeChildProcess.spawn(
    language === "csharp" ? "dotnet" : "java",
    language === "csharp" ? [helper, "--stream"] : ["-Xmx512m", "-jar", helper, "--stream"],
    {
      cwd: input.root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
        DOTNET_NOLOGO: "1",
        DOTNET_GCHeapHardLimit: "0x20000000",
      },
    },
  );
  let failure: Error | undefined;
  let closed = false;
  let stderr = "";
  const completion = new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      failure = error;
      child.stdout.destroy(error);
      resolve(null);
    });
    child.once("close", (code) => resolve(code));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4096);
  });
  child.stdin.on("error", (error) => {
    if (!closed) {
      failure = error;
      child.stdout.destroy(error);
    }
  });
  const stop = (error: Error) => {
    failure = error;
    child.stdout.destroy(error);
    child.stdin.destroy();
    child.kill();
  };
  const abort = () => stop(new Error("Compiler stream cancelled."));
  input.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      stop(new Error("Compiler stream stopped responding; committed batches remain available.")),
    120_000,
  );
  timer.unref();
  const write = async (value: unknown) => {
    if (closed || child.stdin.destroyed) throw failure ?? new Error("Compiler input closed.");
    if (!child.stdin.write(JSON.stringify(value) + "\n")) {
      let onDrain = () => {};
      const drained = new Promise<void>((resolve) => {
        onDrain = resolve;
        child.stdin.once("drain", onDrain);
      });
      try {
        await Promise.race([
          drained,
          completion.then(() => {
            throw failure ?? new Error("Compiler input closed before draining.");
          }),
        ]);
      } finally {
        child.stdin.off("drain", onDrain);
      }
    }
    if (!closed && !failure) timer.refresh();
  };
  const writing = (async () => {
    await write({ root: input.root });
    for await (const file of files) {
      input.signal?.throwIfAborted();
      if (closed) break;
      await write({
        filePath: file.path,
        contentHash: file.contentHash,
        configDependencies: file.configDependencies,
      });
    }
    child.stdin.end();
  })().catch((error: unknown) => {
    if (!closed) stop(error instanceof Error ? error : new Error(String(error)));
  });
  try {
    let buffer = Buffer.alloc(0);
    for await (const chunk of child.stdout) {
      input.signal?.throwIfAborted();
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      while (true) {
        const newline = buffer.indexOf(10);
        if (newline < 0) break;
        if (newline > MAX_RECORD_BYTES)
          throw new Error("A compiler record exceeded its explicit message budget.");
        const line = buffer.subarray(0, newline).toString("utf8").trim();
        buffer = buffer.subarray(newline + 1);
        if (line.length > 0) {
          const message = decodeLine(line);
          clearTimeout(timer);
          yield message;
          timer.refresh();
        }
      }
      if (buffer.length > MAX_RECORD_BYTES)
        throw new Error("A compiler record exceeded its explicit message budget.");
    }
    if (buffer.length > 0) {
      const message = decodeLine(buffer.toString("utf8"));
      clearTimeout(timer);
      yield message;
      timer.refresh();
    }
    await writing;
    const code = await completion;
    if (failure || code !== 0)
      throw failure ?? new Error(`Compiler helper exited (${code}): ${stderr}`);
  } finally {
    closed = true;
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
    child.stdin.destroy();
    child.stdout.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      const force = setTimeout(() => child.kill("SIGKILL"), 1000);
      force.unref();
      child.once("close", () => clearTimeout(force));
    }
    await writing;
  }
}
