import type { NativeProviderToolResult } from "./NativeProviderTypes.ts";
function encodedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const MODEL_TOOL_RESULT_MAX_BYTES = 32 * 1024;
const MODEL_TOOL_RESULT_DIGEST_MAX_BYTES = 16 * 1024;

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const item of Object.values(value)) collectStrings(item, output);
}

function findExitCode(value: unknown): number | null | undefined {
  if (value === null || typeof value !== "object") return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (
      (key === "exitCode" || key === "exit_code") &&
      (typeof item === "number" || item === null)
    ) {
      return item;
    }
    const nested = findExitCode(item);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function changedPaths(result: NativeProviderToolResult): ReadonlyArray<string> {
  const paths: string[] = [];
  const pathFields = new Set([
    "path",
    "paths",
    "filePath",
    "relativePath",
    "changedPaths",
    "changed_paths",
    "files",
  ]);
  const visit = (value: unknown, field?: string): void => {
    if (typeof value === "string") {
      if (field && pathFields.has(field) && value.trim()) paths.push(value.trim().slice(0, 256));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, field);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      visit(item, key);
    }
  };
  visit(result.output);
  return Array.from(new Set(paths)).slice(0, 12);
}

export function modelFacingNativeProviderToolResult(
  result: NativeProviderToolResult,
  input: {
    readonly itemId: string;
    readonly status: "completed" | "failed" | "declined";
  },
): NativeProviderToolResult {
  const byteCount = encodedBytes(result.output);
  if (byteCount <= MODEL_TOOL_RESULT_MAX_BYTES) return result;
  const strings: string[] = [];
  collectStrings(result.output, strings);
  const errorLines = [result.detail, ...strings]
    .flatMap((value) => value.split(/\r?\n/u))
    .map((line) => line.trim())
    .filter((line) =>
      /\b(error|failed|failure|exception|fatal|denied|invalid|not found)\b/iu.test(line),
    )
    .filter((line, index, lines) => line.length > 0 && lines.indexOf(line) === index)
    .slice(0, 12)
    .map((line) => line.slice(0, 256));
  const paths = changedPaths(result);
  const exitCode = findExitCode(result.output);
  const title = result.title.slice(0, 256);
  const detail = result.detail.slice(0, 1_024);
  const output = {
    ok: result.ok,
    status: input.status,
    title,
    detail,
    byteCount,
    lineCount: strings.reduce((count, value) => count + value.split(/\r?\n/u).length, 0),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(paths.length > 0 ? { changedPaths: paths } : {}),
    ...(errorLines.length > 0 ? { errorLines } : {}),
    detailRef: `tool-result:${input.itemId}`,
  };
  if (encodedBytes(output) > MODEL_TOOL_RESULT_DIGEST_MAX_BYTES) {
    return {
      ...result,
      title,
      detail,
      output: {
        ok: result.ok,
        status: input.status,
        title,
        detail,
        byteCount,
        lineCount: strings.reduce((count, value) => count + value.split(/\r?\n/u).length, 0),
        ...(exitCode !== undefined ? { exitCode } : {}),
        detailRef: `tool-result:${input.itemId}`,
      },
    };
  }
  return {
    ...result,
    title,
    detail,
    output,
  };
}
