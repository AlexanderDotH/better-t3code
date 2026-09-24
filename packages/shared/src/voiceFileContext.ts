import { VoiceFileReference, type SpeechProcessDictationResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { collectComposerInlineTokens } from "./composerInlineTokens.ts";
import { serializeComposerFileLink } from "./composerTrigger.ts";

const MAX_CONTEXT_CHARS = 64_000;
const CONTEXT_PATTERN = /(?:\n\n)?<voice_file_context>\n([\s\S]*?)\n<\/voice_file_context>/g;
const VoiceContext = Schema.Struct({
  version: Schema.Literal(1),
  references: Schema.Array(VoiceFileReference),
});
const decodeVoiceContext = Schema.decodeUnknownOption(VoiceContext);
const CANDIDATE_INSTRUCTIONS =
  "These are alternative workspace files for the same spoken reference. The visible link previews the first candidate only. Inspect the candidates and choose the file that fits the user's request; the first path is not a binding selection. A truncated list is incomplete.";

export function reconcileVoiceFileReferences(
  text: string,
  references: readonly VoiceFileReference[],
): VoiceFileReference[] {
  if (references.length === 0) return [];
  const paths = new Set(
    collectComposerInlineTokens(`${text} `)
      .filter((token) => token.type === "mention")
      .map((token) => token.value),
  );
  const byPreviewPath = new Map<string, VoiceFileReference>();
  for (const reference of references) {
    if (paths.has(reference.previewPath)) byPreviewPath.set(reference.previewPath, reference);
  }
  return [...byPreviewPath.values()];
}

function encodeContext(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}

export function extractVoiceFileContext(prompt: string): {
  text: string;
  references: VoiceFileReference[];
} {
  const references: VoiceFileReference[] = [];
  const text = prompt.replace(CONTEXT_PATTERN, (block: string, json: string) => {
    if (json.length > MAX_CONTEXT_CHARS) return block;
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      return block;
    }
    const decoded = decodeVoiceContext(data);
    if (Option.isNone(decoded)) return block;
    references.push(...decoded.value.references);
    return "";
  });
  return { text, references: reconcileVoiceFileReferences(text, references) };
}

function boundVoiceReferences(references: readonly VoiceFileReference[]): {
  references: VoiceFileReference[];
  truncated: boolean;
} {
  const bounded: VoiceFileReference[] = [];
  let remaining = MAX_CONTEXT_CHARS - CANDIDATE_INSTRUCTIONS.length - 1_024;
  let truncated = false;
  for (const reference of references) {
    const candidates: VoiceFileReference["candidates"][number][] = [];
    const overhead = encodeContext({ ...reference, candidates: [] }).length + 1;
    if (overhead > remaining) {
      truncated = true;
      break;
    }
    remaining -= overhead;
    let omitted = reference.truncated;
    for (const candidate of reference.candidates) {
      const size = encodeContext(candidate).length + 1;
      if (size > remaining) {
        omitted = true;
        break;
      }
      candidates.push(candidate);
      remaining -= size;
    }
    bounded.push({ ...reference, candidates, truncated: omitted });
    truncated ||= omitted;
  }
  return { references: bounded, truncated };
}

export function appendVoiceFileContext(
  prompt: string,
  references: readonly VoiceFileReference[],
): string {
  const extracted = extractVoiceFileContext(prompt);
  const current = reconcileVoiceFileReferences(extracted.text, [
    ...extracted.references,
    ...references,
  ]);
  if (current.length === 0) return extracted.text;
  const bounded = boundVoiceReferences(current);
  const context = encodeContext({
    version: 1,
    instructions: CANDIDATE_INSTRUCTIONS,
    ...bounded,
  });
  return `${extracted.text}\n\n<voice_file_context>\n${context}\n</voice_file_context>`;
}

/** Translation may change prose, but must not change file identity or drop a reference. */
export async function translateVoiceDictationResult(
  result: SpeechProcessDictationResult,
  translate: (text: string) => Promise<string>,
): Promise<SpeechProcessDictationResult> {
  let prefix = "T3VOICEFILE";
  while (result.text.includes(prefix)) prefix += "X";
  let protectedText = result.text;
  const replacements = result.references.map((reference, index) => {
    const link = serializeComposerFileLink(reference.previewPath);
    const marker = `${prefix}${index}TOKEN`;
    const count = protectedText.split(link).length - 1;
    protectedText = protectedText.replaceAll(link, marker);
    return { marker, link, count };
  });
  let translated = await translate(protectedText);
  if (result.text.trim() && !translated.trim()) {
    throw new Error("Voice translation returned no text.");
  }
  for (const { marker, link, count } of replacements) {
    if (translated.split(marker).length - 1 !== count) {
      throw new Error("Voice translation changed a file reference.");
    }
    translated = translated.replaceAll(marker, link);
  }
  return {
    ...result,
    text: translated,
    references: reconcileVoiceFileReferences(translated, result.references),
  };
}
