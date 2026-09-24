import { describe, expect, it } from "vite-plus/test";
import type { VoiceFileReference } from "@t3tools/contracts";
import { serializeComposerFileLink } from "./composerTrigger.ts";
import { collectComposerInlineTokens } from "./composerInlineTokens.ts";
import {
  appendVoiceFileContext,
  extractVoiceFileContext,
  reconcileVoiceFileReferences,
  translateVoiceDictationResult,
} from "./voiceFileContext.ts";

const reference: VoiceFileReference = {
  label: "index.ts",
  previewPath: "apps/server/index.ts",
  candidates: [
    { path: "apps/server/index.ts", symbols: [{ name: "startServer", kind: "function", line: 4 }] },
    { path: "apps/web/index.ts", symbols: [{ name: "App", kind: "class", line: 2 }] },
  ],
  truncated: false,
};
const prompt = `Ändere ${serializeComposerFileLink(reference.previewPath)} ohne die API zu ändern.`;

describe("voice file context", () => {
  it("keeps basename-only chips with every alternative and symbol available to the agent", () => {
    expect(prompt).toContain("[index.ts](apps/server/index.ts)");
    expect(collectComposerInlineTokens(prompt)).toMatchObject([{ value: reference.previewPath }]);
    const sent = appendVoiceFileContext(prompt, [reference]);
    expect(sent).toContain("apps/web/index.ts");
    expect(sent).toContain("startServer");
    expect(sent).toContain("first path is not a binding selection");
    expect(extractVoiceFileContext(sent)).toEqual({ text: prompt, references: [reference] });
  });

  it("drops metadata when a chip is removed and preserves it at the end of the draft", () => {
    expect(reconcileVoiceFileReferences("Ändere index.ts", [reference])).toEqual([]);
    expect(appendVoiceFileContext("Ändere index.ts", [reference])).toBe("Ändere index.ts");
    expect(
      reconcileVoiceFileReferences(serializeComposerFileLink(reference.previewPath), [reference]),
    ).toEqual([reference]);
    const punctuated = `Change ${serializeComposerFileLink(reference.previewPath)}. Keep the API.`;
    expect(reconcileVoiceFileReferences(punctuated, [reference])).toEqual([reference]);
    expect(collectComposerInlineTokens(punctuated)).toMatchObject([
      { value: reference.previewPath },
    ]);
  });

  it("round-trips message editing and resending without duplicating the block", () => {
    const sent = appendVoiceFileContext(prompt, [reference]);
    const restored = extractVoiceFileContext(sent);
    expect(appendVoiceFileContext(restored.text, restored.references)).toBe(sent);
    expect(appendVoiceFileContext(sent, [reference])).toBe(sent);
    expect(
      extractVoiceFileContext(`${sent}\n\n<terminal_context>example</terminal_context>`).text,
    ).toBe(`${prompt}\n\n<terminal_context>example</terminal_context>`);
  });

  it("uses the newest candidate snapshot when a file is dictated again", () => {
    const updated = {
      ...reference,
      candidates: [...reference.candidates, { path: "apps/mobile/index.ts", symbols: [] }],
    };
    expect(reconcileVoiceFileReferences(prompt, [reference, updated])).toEqual([updated]);
    expect(
      extractVoiceFileContext(
        appendVoiceFileContext(appendVoiceFileContext(prompt, [reference]), [updated]),
      ).references,
    ).toEqual([updated]);
  });

  it("preserves malformed user content instead of silently deleting it", () => {
    const invalid = `${prompt}\n\n<voice_file_context>\nnot json\n</voice_file_context>`;
    expect(extractVoiceFileContext(invalid)).toEqual({ text: invalid, references: [] });
  });

  it("marks bounded candidate lists incomplete", () => {
    const large = {
      ...reference,
      candidates: Array.from({ length: 1_000 }, (_, index) => ({
        path: `packages/${index}/${"long-path/".repeat(30)}index.ts`,
        symbols: [],
      })),
    };
    const sent = appendVoiceFileContext(prompt, [large]);
    const restored = extractVoiceFileContext(sent);
    expect(restored.references[0]?.truncated).toBe(true);
    expect(restored.references[0]?.candidates.length).toBeLessThan(large.candidates.length);
    expect(sent.length).toBeLessThan(65_000);
  });

  it("escapes block delimiters within filenames and preserves the path", () => {
    const unusual = {
      ...reference,
      candidates: [{ path: "src/<voice_file_context>.ts", symbols: [] }],
    };
    const sent = appendVoiceFileContext(prompt, [unusual]);
    expect(extractVoiceFileContext(sent).references).toEqual([unusual]);
  });

  it("preserves reference identity during translation and prompt improvements", async () => {
    const result = await translateVoiceDictationResult(
      { text: prompt, references: [reference] },
      async (text) => {
        expect(text).not.toContain("apps/server");
        return text
          .replace("Ändere", "Change")
          .replace("ohne die API zu ändern", "without changing the API");
      },
    );
    expect(result.text).toBe(
      prompt
        .replace("Ändere", "Change")
        .replace("ohne die API zu ändern", "without changing the API"),
    );
    expect(result.references).toEqual([reference]);
  });

  it("rejects translation that drops or duplicates a file reference", async () => {
    await expect(
      translateVoiceDictationResult(
        { text: prompt, references: [reference] },
        async () => "Change the file",
      ),
    ).rejects.toThrow("file reference");
    await expect(
      translateVoiceDictationResult(
        { text: prompt, references: [reference] },
        async (text) => `${text} ${text}`,
      ),
    ).rejects.toThrow("file reference");
  });
});
