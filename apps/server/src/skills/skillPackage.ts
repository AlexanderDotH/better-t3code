import * as NodeCrypto from "node:crypto";
import { isValidSkillName, parseSkillFile } from "./skillFile.ts";

export const MAX_SKILL_FILES = 500;
export const MAX_SKILL_BYTES = 8 * 1024 * 1024;

export interface RegistrySkillFile {
  readonly path: string;
  readonly contents: string;
  readonly encoding?: "base64";
  readonly executable?: boolean;
}

export function registrySkillFileBytes(file: RegistrySkillFile) {
  return Buffer.from(file.contents, file.encoding === "base64" ? "base64" : "utf8");
}

export function validateRegistrySkillFiles(files: readonly RegistrySkillFile[]) {
  if (files.length === 0 || files.length > MAX_SKILL_FILES)
    throw new Error("The skill has too many files or is empty.");
  const paths = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    const parts = file.path.split("/");
    if (
      file.path.length > 500 ||
      parts.some(
        (part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git",
      ) ||
      /[\\\p{Cc}:]/u.test(file.path)
    ) {
      throw new Error("The skill contains an unsafe file path.");
    }
    const key = file.path.toLowerCase();
    if (paths.has(key)) throw new Error("The skill contains duplicate file paths.");
    paths.add(key);
    bytes += registrySkillFileBytes(file).length;
    if (bytes > MAX_SKILL_BYTES) throw new Error("The skill exceeds the 8 MB installation limit.");
  }
  const main = files.find((file) => file.path === "SKILL.md");
  if (!main || main.encoding) throw new Error("The skill does not include a UTF-8 SKILL.md.");
  const parsed = parseSkillFile(main.contents);
  if (!parsed.name || !isValidSkillName(parsed.name))
    throw new Error("The skill has an invalid name.");
  const contentHash = NodeCrypto.createHash("sha256")
    .update(JSON.stringify(files.toSorted((a, b) => a.path.localeCompare(b.path))))
    .digest("hex");
  return { parsed, name: parsed.name, contentHash };
}
