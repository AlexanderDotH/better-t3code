// @effect-diagnostics nodeBuiltinImport:off - Read-only Git metadata commands admit source paths without hooks, filters or project execution.
// @effect-diagnostics globalTimers:off - Deadlines terminate only the captured Git subprocess.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { isWorkspaceRelativePath } from "../privacy/WorkspacePrivacy.ts";
import { isWithinRoot, portablePath } from "./source.ts";

export const GIT_IGNORE_BATCH_SIZE = 128;
const MAX_GIT_INPUT_BYTES = 64 * 1024;
const MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_GIT_TOKEN_BYTES = 32 * 1024;
const GIT_READ_OPTIONS = [
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
] as const;

export interface GitIgnoredPath {
  readonly reason: string;
  readonly hasTrackedDescendants: boolean;
}

function gitEnvironment() {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  for (const key of Object.keys(env)) {
    if (
      [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_CEILING_DIRECTORIES",
        "GIT_LITERAL_PATHSPECS",
        "GIT_GLOB_PATHSPECS",
        "GIT_NOGLOB_PATHSPECS",
        "GIT_ICASE_PATHSPECS",
      ].includes(key) ||
      key.startsWith("GIT_TRACE")
    )
      delete env[key];
  }
  return env;
}

async function readGit(
  root: string,
  args: readonly string[],
  input: string | undefined,
  signal?: AbortSignal,
  token?: (value: string) => void,
) {
  signal?.throwIfAborted();
  const child = NodeChildProcess.spawn("git", [...GIT_READ_OPTIONS, "-C", root, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: gitEnvironment(),
  });
  let failure: Error | undefined;
  let stderr = "";
  const completion = new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      failure = error;
      child.stdout.destroy(error);
      resolve(null);
    });
    child.once("close", resolve);
  });
  child.stderr.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString("utf8")).slice(-4096);
  });
  child.stdin.on("error", (error) => {
    failure = error;
    child.stdout.destroy(error);
  });
  const stop = (error: Error) => {
    failure = error;
    child.stdin.destroy();
    child.stdout.destroy(error);
    child.kill();
  };
  const abort = () => stop(new Error("Git ignore inspection cancelled."));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => stop(new Error("Git ignore inspection timed out; source admission stopped.")),
    20_000,
  );
  timer.unref();
  child.stdin.end(input);
  try {
    let buffer = Buffer.alloc(0);
    for await (const chunk of child.stdout) {
      signal?.throwIfAborted();
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      if (token) {
        while (true) {
          const end = buffer.indexOf(0);
          if (end < 0) break;
          if (end > MAX_GIT_TOKEN_BYTES)
            throw new Error("Git metadata record exceeded its explicit size budget.");
          token(buffer.subarray(0, end).toString("utf8"));
          buffer = buffer.subarray(end + 1);
        }
        if (buffer.length > MAX_GIT_TOKEN_BYTES)
          throw new Error("Git metadata record exceeded its explicit size budget.");
      } else if (buffer.length > MAX_GIT_OUTPUT_BYTES)
        throw new Error("Git metadata response exceeded its explicit size budget.");
    }
    const code = await completion;
    if (failure) throw failure;
    if (token && buffer.length > 0)
      throw new Error("Git returned an incomplete NUL-delimited metadata record.");
    return { code, stdout: token ? "" : buffer.toString("utf8"), stderr };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    child.stdin.destroy();
    child.stdout.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      const force = setTimeout(() => child.kill("SIGKILL"), 1000);
      force.unref();
      child.once("close", () => clearTimeout(force));
    }
  }
}

function* pathBatches(paths: readonly string[]) {
  let batch: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(path) + 1;
    if (size > MAX_GIT_INPUT_BYTES)
      throw new Error("A source path exceeds the Git metadata request budget.");
    if (
      batch.length > 0 &&
      (batch.length === GIT_IGNORE_BATCH_SIZE || bytes + size > MAX_GIT_INPUT_BYTES)
    ) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(path);
    bytes += size;
  }
  if (batch.length > 0) yield batch;
}

function ignoreReason(source: string, line: string): string {
  const normalized = source.replaceAll("\\", "/");
  const suffix = /^\d+$/.test(line) ? `, line ${line}` : "";
  if (normalized.endsWith("/info/exclude")) return `Git local exclude rule${suffix}`;
  if (NodePath.posix.basename(normalized) === ".gitignore") {
    const safe = isWorkspaceRelativePath(normalized);
    return `Git ignore rule (${safe ? normalized : "ancestor .gitignore"}${suffix})`;
  }
  return `Git global ignore rule${suffix}`;
}

/** Each inspection retains only its input window and one tracked-descendant flag per ignored directory. */
export async function createGitIgnoreFilter(workspaceRoot: string, signal?: AbortSignal) {
  const root = await NodeFSP.realpath(workspaceRoot);
  const repository = await readGit(root, ["rev-parse", "--show-toplevel"], undefined, signal);
  if (repository.code !== 0) {
    if (repository.code === 128 && repository.stderr.includes("not a git repository")) {
      return {
        isRepository: false,
        async inspect(_paths: readonly string[]) {
          return new Map<string, GitIgnoredPath>();
        },
      };
    }
    throw new Error(
      `Git repository inspection failed (exit ${repository.code}); source admission stopped.`,
    );
  }
  const repositoryRoot = await NodeFSP.realpath(repository.stdout.replace(/[\r\n]+$/, ""));
  if (!isWithinRoot(repositoryRoot, root))
    throw new Error("Git resolved a repository outside the selected source workspace.");
  const known = new Map<string, GitIgnoredPath | undefined>();
  return {
    isRepository: true,
    async inspect(paths: readonly string[]): Promise<Map<string, GitIgnoredPath>> {
      const ignored = new Map<string, GitIgnoredPath>();
      const fresh: string[] = [];
      for (const path of paths) {
        if (!known.has(path)) fresh.push(path);
        else {
          const cached = known.get(path);
          if (cached) ignored.set(path, cached);
        }
      }
      for (const batch of pathBatches(fresh)) {
        const result = await readGit(
          root,
          ["check-ignore", "--verbose", "--stdin", "-z"],
          batch.map((path) => `./${path}`).join("\0") + "\0",
          signal,
        );
        if (result.code !== 0 && result.code !== 1)
          throw new Error(
            `Git ignore check failed (exit ${result.code}); source admission stopped.`,
          );
        const fields = result.stdout.split("\0");
        if (fields.at(-1) === "") fields.pop();
        if (fields.length % 4 !== 0)
          throw new Error("Git returned malformed ignore-rule metadata; source admission stopped.");
        for (let offset = 0; offset < fields.length; offset += 4) {
          const [source, line, pattern, filePath] = fields.slice(offset, offset + 4);
          if (!source || !pattern || !filePath || pattern.startsWith("!")) continue;
          const path = filePath.startsWith("./") ? filePath.slice(2) : filePath;
          if (!batch.includes(path))
            throw new Error("Git ignore response did not match its bounded source window.");
          ignored.set(path, {
            reason: ignoreReason(source, line ?? ""),
            hasTrackedDescendants: false,
          });
        }
      }
      const directories: string[] = [];
      const inspected = new Set(fresh);
      for (const filePath of ignored.keys()) {
        if (!inspected.has(filePath)) continue;
        const stat = await NodeFSP.lstat(NodePath.join(root, filePath)).catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT")
            return undefined;
          throw error;
        });
        if (stat?.isDirectory() && !stat.isSymbolicLink()) directories.push(filePath);
      }
      for (const batch of pathBatches(directories)) {
        const prefixes = batch.map((filePath) => ({
          filePath,
          prefix: portablePath(NodePath.relative(repositoryRoot, NodePath.join(root, filePath))),
        }));
        const tracked = new Set<string>();
        const result = await readGit(
          root,
          ["--literal-pathspecs", "ls-files", "--cached", "--full-name", "-z", "--", ...batch],
          undefined,
          signal,
          (filePath) => {
            for (const directory of prefixes)
              if (filePath === directory.prefix || filePath.startsWith(directory.prefix + "/"))
                tracked.add(directory.filePath);
          },
        );
        if (result.code !== 0)
          throw new Error(
            `Git tracked-path inspection failed (exit ${result.code}); source admission stopped.`,
          );
        for (const directory of tracked)
          ignored.set(directory, { ...ignored.get(directory)!, hasTrackedDescendants: true });
      }
      for (const path of fresh) {
        known.set(path, ignored.get(path));
        if (known.size > GIT_IGNORE_BATCH_SIZE * 4) known.delete(known.keys().next().value!);
      }
      return ignored;
    },
  };
}
