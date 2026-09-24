import { RocksDatabase, type Transaction } from "@harperfast/rocksdb-js";

const SEPARATOR = "\0";
const NEXT_SEPARATOR = "\u0001";

export function openKnowledgeKvDatabase(path: string, options?: { readonly readOnly?: boolean }) {
  return RocksDatabase.open(path, { keyEncoding: "binary", ...options });
}

export function kvKeyText(key: unknown): string {
  if (typeof key === "string") return key;
  if (key instanceof Uint8Array) return Buffer.from(key).toString("utf8");
  throw new Error("Unexpected knowledge KV key encoding.");
}

export function kvKey(...parts: ReadonlyArray<string>): string {
  if (parts.some((part) => part.includes(SEPARATOR)))
    throw new Error("Knowledge keys cannot contain NUL characters.");
  return parts.join(SEPARATOR);
}

export function kvPrefix(...parts: ReadonlyArray<string>) {
  const base = kvKey(...parts);
  return { start: `${base}${SEPARATOR}`, end: `${base}${NEXT_SEPARATOR}` };
}

export function kvStringPrefix(prefix: string) {
  const start = Buffer.from(prefix);
  const end = Buffer.from(start);
  for (let index = end.length - 1; index >= 0; index--) {
    if (end[index] === 0xff) continue;
    end[index]! += 1;
    return { start, end: end.subarray(0, index + 1) };
  }
  throw new Error("Knowledge KV prefixes cannot consist entirely of 0xFF bytes.");
}

export async function* scanKvPrefix(
  database: RocksDatabase | Transaction,
  ...parts: ReadonlyArray<string>
): AsyncGenerator<{ readonly key: string; readonly value: unknown }> {
  for await (const entry of database.getRange(kvPrefix(...parts)))
    yield { key: kvKeyText(entry.key), value: entry.value };
}
