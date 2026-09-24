// @effect-diagnostics nodeBuiltinImport:off - Roslyn/JDT use owned analysis-only subprocesses and packaged assets.
// @effect-diagnostics globalTimers:off - A hard deadline bounds the owned compiler subprocess lifetime.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as Schema from "effect/Schema";

import { resolveFilesystemAsset } from "./assets.ts";
import { coverageGap } from "./inventory.ts";
import {
  declarationTarget,
  groupByFile,
  resolvedCallsite,
  type SemanticInput,
  type SemanticResult,
} from "./semantic.ts";
import { readSourceUnit } from "./source.ts";

const Target = Schema.Struct({
  filePath: Schema.String,
  startOffset: Schema.Int,
  endOffset: Schema.Int,
});
const HelperResult = Schema.Struct({
  calls: Schema.Array(
    Schema.Struct({
      filePath: Schema.String,
      startOffset: Schema.Int,
      endOffset: Schema.Int,
      targets: Schema.Array(Target),
      exact: Schema.Boolean,
      reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
  gaps: Schema.Array(
    Schema.Struct({
      message: Schema.String,
      filePath: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});
const decodeHelperResult = Schema.decodeUnknownSync(HelperResult);
const HELPER_TIMEOUT_MS = 120_000;
const HELPER_OUTPUT_BYTES = 64 * 1024 * 1024;

export async function resolveAnalysisHelper(
  language: "csharp" | "java",
  moduleUrl = import.meta.url,
): Promise<string | undefined> {
  const here = NodePath.dirname(NodeURL.fileURLToPath(moduleUrl));
  const name = language === "csharp" ? "ProjectIndexer.dll" : "project-indexer-java.jar";
  // Packaged entrypoints and shared chunks all live in dist; source tests use development helper output.
  const candidates = [
    NodePath.join(here, "project-indexer", name),
    ...(moduleUrl.endsWith(".ts")
      ? [
          NodePath.resolve(
            here,
            "../../../../../native",
            language === "csharp"
              ? "project-indexer-dotnet/bin/Release/net10.0/ProjectIndexer.dll"
              : "project-indexer-java/target/project-indexer-java.jar",
          ),
        ]
      : []),
  ];
  for (const candidate of candidates) {
    try {
      return resolveFilesystemAsset(candidate);
    } catch {
      /* A missing optional helper is reported as an explicit coverage gap by the caller. */
    }
  }
  return undefined;
}

async function runHelper(
  command: string,
  args: string[],
  request: unknown,
  root: string,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
        DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
        DOTNET_NOLOGO: "1",
        DOTNET_GCHeapHardLimit: "0x20000000",
      },
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      child.stdin.end();
      child.kill();
      const forceExit = setTimeout(() => child.kill("SIGKILL"), 1000);
      forceExit.unref();
      child.once("close", () => clearTimeout(forceExit));
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(new Error("Semantic helper cancelled."));
    const timer = setTimeout(
      () =>
        finish(
          new Error("Semantic helper exceeded its time budget; syntactic inventory is preserved."),
        ),
      HELPER_TIMEOUT_MS,
    );
    timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > HELPER_OUTPUT_BYTES)
        finish(
          new Error(
            "Semantic helper exceeded its output budget; the project needs smaller semantic batches.",
          ),
        );
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdout.on("error", (error) => finish(error));
    child.stdin.on("error", (error) => finish(error));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(
          new Error(
            `Semantic helper exited with status ${code}. Check the installed runtime and packaged helper.`,
          ),
        );
        return;
      }
      try {
        finish(undefined, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        finish(new Error(`Invalid semantic helper response: ${String(error)}`));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export async function resolveNativeLanguage(
  input: SemanticInput,
  language: "csharp" | "java",
  helperPath?: string,
): Promise<SemanticResult> {
  const helper = helperPath
    ? resolveFilesystemAsset(helperPath)
    : await resolveAnalysisHelper(language);
  if (!helper)
    return {
      callsites: [...input.callsites],
      gaps: [
        coverageGap(
          "incomplete-analysis",
          `${language === "csharp" ? "Roslyn" : "JDT"} semantic helper is not packaged; all syntax entities remain available.`,
          undefined,
          true,
        ),
      ],
    };
  const sources = [];
  for (const file of input.files)
    sources.push({
      filePath: file.path,
      source: await readSourceUnit({
        root: input.root,
        filePath: file.path,
        expectedHash: file.contentHash,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    });
  const request = {
    root: input.root,
    sources,
    configPaths: [...new Set(input.files.flatMap((file) => file.configDependencies))],
  };
  const result = decodeHelperResult(
    await runHelper(
      language === "csharp" ? "dotnet" : "java",
      language === "csharp" ? [helper] : ["-Xmx512m", "-jar", helper],
      request,
      input.root,
      input.signal,
    ),
  );
  const entitiesByFile = groupByFile(input.entities);
  const calls = new Map(
    result.calls.map((call) => [`${call.filePath}:${call.startOffset}:${call.endOffset}`, call]),
  );
  const callsites = input.callsites.map((callsite) => {
    const call = calls.get(
      `${callsite.filePath}:${callsite.range.startOffset}:${callsite.range.endOffset}`,
    );
    if (!call) return callsite;
    const targets = call.targets.flatMap((target) => {
      const entity = declarationTarget(
        entitiesByFile.get(target.filePath) ?? [],
        target.startOffset,
        target.endOffset,
      );
      return entity ? [entity] : [];
    });
    const resolved = resolvedCallsite(
      callsite,
      targets,
      language === "csharp" ? "Roslyn semantic model" : "Eclipse JDT bindings",
      call.exact && targets.length === call.targets.length,
    );
    return call.reason ? { ...resolved, reason: `${resolved.reason} ${call.reason}` } : resolved;
  });
  return {
    callsites,
    gaps: result.gaps.map((gap) =>
      coverageGap("incomplete-analysis", gap.message, gap.filePath ?? undefined),
    ),
  };
}
