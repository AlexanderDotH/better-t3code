import type { ProjectScript } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  parseProjectIcon,
  parseProjectScript,
  upsertProjectScript,
} from "./project-editor-settings";

describe("mobile project editors", () => {
  it("validates icon forms and normalizes monograms", () => {
    expect(parseProjectIcon("monogram", " é1 ", "blue")).toEqual({
      kind: "monogram",
      text: "É1",
      color: "blue",
    });
    expect(parseProjectIcon("monogram", "ABC", "blue")).toBeNull();
    expect(parseProjectIcon("monogram", "A!", "blue")).toBeNull();
    expect(parseProjectIcon("emoji", "hello", "blue")).toBeNull();
    expect(parseProjectIcon("emoji", "hello 💻", "blue")).toBeNull();
    expect(parseProjectIcon("emoji", "💻💻", "blue")).toBeNull();
    expect(parseProjectIcon("emoji", "🇫🇷", "blue")).toEqual({ kind: "emoji", emoji: "🇫🇷" });
    expect(parseProjectIcon("emoji", "👩🏽‍💻", "blue")).toEqual({ kind: "emoji", emoji: "👩🏽‍💻" });
    expect(parseProjectIcon("lucide", "folder-code", "rose")).toEqual({
      kind: "lucide",
      name: "folder-code",
      color: "rose",
    });
  });

  it("serializes script fields and releases exclusive setup and settle roles", () => {
    const existing: ProjectScript = {
      id: "setup",
      name: "Setup",
      command: "install",
      icon: "configure",
      runOnWorktreeCreate: true,
      runOnSettle: true,
      async: false,
    };
    const next: ProjectScript = {
      id: "dev",
      name: " Dev ",
      command: " run dev\n ",
      icon: "play",
      runOnWorktreeCreate: true,
      runOnSettle: true,
      async: false,
      previewUrl: " http://localhost:3000 ",
      autoOpenPreview: true,
    };
    const parsed = parseProjectScript(next);
    expect(parsed).toEqual({
      ...next,
      name: "Dev",
      command: "run dev",
      previewUrl: "http://localhost:3000",
    });
    const scripts = upsertProjectScript([existing], parsed!);
    expect(scripts).toEqual([
      { ...existing, runOnWorktreeCreate: false, runOnSettle: false },
      parsed,
    ]);
    expect(upsertProjectScript(scripts, { ...parsed!, command: "changed" })).toHaveLength(2);
    expect(parseProjectScript({ ...next, command: " " })).toBeNull();
    expect(parseProjectScript({ ...next, previewUrl: " " })).not.toHaveProperty("previewUrl");
    expect(parseProjectScript({ ...next, previewUrl: " " })).not.toHaveProperty("autoOpenPreview");
  });
});
