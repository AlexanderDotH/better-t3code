// @effect-diagnostics nodeBuiltinImport:off - Read-only compiler boundary is also used outside an Effect runtime.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ProjectSourceRangeV1 } from "@t3tools/contracts";

import { assertNoSymlinkPath, isSafeProjectSourcePath } from "../privacy/WorkspacePrivacy.ts";
export function sourceHash(source: string | Uint8Array): string {
  return NodeCrypto.createHash("sha256").update(source).digest("hex");
}

export function stableId(kind: string, ...parts: readonly string[]): string {
  return `${kind}:${sourceHash(JSON.stringify(parts))}`;
}

export function portablePath(value: string): string {
  return value.split(NodePath.sep).join("/");
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = NodePath.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  );
}

async function resolveSourcePath(root: string, filePath: string): Promise<string> {
  if (!isSafeProjectSourcePath(filePath))
    throw new Error("Private source paths cannot be indexed.");
  if (NodePath.isAbsolute(filePath) || filePath.split(/[\\/]/).includes("..")) {
    throw new Error("Source paths must be relative to the project root.");
  }
  const canonicalRoot = await NodeFSP.realpath(root);
  const resolved = await NodeFSP.realpath(NodePath.join(canonicalRoot, filePath));
  if (!isWithinRoot(canonicalRoot, resolved))
    throw new Error("Source path leaves the project root.");
  await assertNoSymlinkPath(canonicalRoot, NodePath.join(canonicalRoot, filePath));
  return resolved;
}

export async function hashFile(filePath: string, signal?: AbortSignal) {
  const hash = NodeCrypto.createHash("sha256");
  let bytes = 0;
  let sample = Buffer.alloc(0);
  const stream = NodeFS.createReadStream(filePath, { signal });
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    bytes += buffer.length;
    if (sample.length < 8192)
      sample = Buffer.concat([sample, buffer.subarray(0, 8192 - sample.length)]);
  }
  return { contentHash: hash.digest("hex"), bytes, sample };
}

export function createSourceLocator(source: string) {
  const lineStarts = [0];
  for (let offset = 0; offset < source.length; offset++)
    if (source[offset] === "\n") lineStarts.push(offset + 1);
  const positionAt = (offset: number) => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (lineStarts[middle]! <= offset) low = middle;
      else high = middle;
    }
    return { line: low, character: offset - lineStarts[low]! };
  };
  const offsetAt = (position: { line: number; character: number }) =>
    Math.min(source.length, (lineStarts[position.line] ?? source.length) + position.character);
  return { positionAt, offsetAt };
}

export function rangeFromOffsets(
  source: string,
  startOffset: number,
  endOffset: number,
): ProjectSourceRangeV1 {
  const locator = createSourceLocator(source);
  const start = locator.positionAt(startOffset);
  const end = locator.positionAt(endOffset);
  return {
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
    startOffset,
    endOffset,
  };
}

export async function readSourceUnit(input: {
  root: string;
  filePath: string;
  expectedHash: string;
  range?: ProjectSourceRangeV1;
  signal?: AbortSignal;
}): Promise<string> {
  input.signal?.throwIfAborted();
  const source = await NodeFSP.readFile(await resolveSourcePath(input.root, input.filePath), {
    encoding: "utf8",
    signal: input.signal,
  });
  if (sourceHash(source) !== input.expectedHash)
    throw new Error(`Source changed since indexing: ${input.filePath}`);
  if (!input.range) return source;
  const { startOffset, endOffset } = input.range;
  if (
    startOffset === undefined ||
    endOffset === undefined ||
    startOffset < 0 ||
    endOffset < startOffset ||
    endOffset > source.length
  ) {
    throw new Error("Source unit requires valid UTF-16 offsets.");
  }
  return source.slice(startOffset, endOffset);
}
