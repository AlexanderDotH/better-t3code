import { describe, expect, it } from "vite-plus/test";

import type { ProjectMemoryEntry, ProjectMemorySection } from "@t3tools/contracts";

import {
  parseProjectMemoryDocument,
  projectMemoryTokenBudget,
  sanitizeProjectMemoryContent,
  selectProjectMemoryEntries,
  serializeProjectMemoryDocument,
  upsertProjectMemoryEntry,
} from "./ProjectMemoryDocument.ts";

const entry = (
  key: string,
  content: string,
  section: ProjectMemorySection = "verified-workflows",
): ProjectMemoryEntry => ({
  section,
  key,
  content,
  verified: true,
  sourceThreadId: "thread-memory-document" as ProjectMemoryEntry["sourceThreadId"],
});

describe("project memory Markdown", () => {
  it("round-trips stable entries through all human-readable sections", () => {
    const entries = [
      entry("profile.repository", "T3 Code server and clients.", "project-profile"),
      entry("decision.atomic-write", "Use a temp file and atomic rename.", "active-decisions"),
      entry("workflow.node-24", "Run focused tests under Node 24.", "verified-workflows"),
      entry("pitfall.shared-tree", "Preserve unrelated dirty changes.", "known-pitfalls"),
      {
        ...entry("outcome.contracts", "Project memory contracts passed.", "recent-outcomes"),
        checkpointRef: "refs/checkpoints/memory" as ProjectMemoryEntry["checkpointRef"],
      },
    ];

    const markdown = serializeProjectMemoryDocument(entries);

    expect(markdown).toContain("## Project profile");
    expect(markdown).toContain("## Active decisions");
    expect(markdown).toContain("## Verified workflows");
    expect(markdown).toContain("## Known pitfalls");
    expect(markdown).toContain("## Recent outcomes");
    expect(markdown).toContain("- Source thread: `thread-memory-document`");
    expect(parseProjectMemoryDocument(markdown)).toEqual(entries);
  });

  it("replaces every duplicate of one exact key without touching prefix siblings", () => {
    const existing = [
      entry("build.node", "old one"),
      entry("build.node", "old duplicate", "known-pitfalls"),
      entry("build.node-24", "keep sibling"),
    ];

    const result = upsertProjectMemoryEntry(existing, entry("build.node", "replacement"));

    expect(result.replaced).toBe(true);
    expect(result.entries.filter((candidate) => candidate.key === "build.node")).toEqual([
      entry("build.node", "replacement"),
    ]);
    expect(result.entries).toContainEqual(entry("build.node-24", "keep sibling"));
  });
});

describe("project memory safety and relevance", () => {
  it("redacts obvious credentials, passwords, bearer tokens, and pairing URLs", () => {
    const content = sanitizeProjectMemoryContent(`
password=hunter2
Authorization: Bearer secret-bearer-token
api_key=sk-proj-1234567890abcdef
Pair at https://host.example/pair#token=pairing-secret
`);

    expect(content).not.toMatch(/hunter2|secret-bearer-token|1234567890abcdef|pairing-secret/);
    expect(content).toContain("[REDACTED]");
  });

  it("uses the exact context budget formula and deterministic lexical/path/symbol ranking", () => {
    const entries = [
      entry("workflow.build", "Run a generic build."),
      entry(
        "workflow.project-memory-store",
        "Use src/projectMemory/ProjectMemoryStore.ts and rememberSymbol.",
      ),
      entry("pitfall.tokens", "Never persist credentials.", "known-pitfalls"),
    ];

    expect(projectMemoryTokenBudget(10_000)).toBe(1_000);
    expect(projectMemoryTokenBudget(100_000)).toBe(2_000);
    expect(projectMemoryTokenBudget(500_000)).toBe(4_000);

    const first = selectProjectMemoryEntries(
      entries,
      "src/projectMemory/ProjectMemoryStore rememberSymbol",
      100_000,
    );
    const second = selectProjectMemoryEntries(
      entries,
      "src/projectMemory/ProjectMemoryStore rememberSymbol",
      100_000,
    );

    expect(first).toEqual(second);
    expect(first.entries.map((candidate) => candidate.key)).toEqual([
      "workflow.project-memory-store",
    ]);
    expect(first.estimatedTokens).toBeLessThanOrEqual(first.tokenBudget);
  });

  it("injects nothing for empty or common English and German turn text", () => {
    const entries = [
      entry("workflow.continue", "Continue the project work after the user replies."),
      entry("workflow.weiter", "Mit der Arbeit am Projekt weiter machen."),
      entry("workflow.keep-going", "Please keep working and continue the work."),
      entry("workflow.fortfahren", "Bitte fortfahren und mach weiter."),
    ];

    for (const query of [
      "",
      "please continue with the work",
      "please keep working",
      "what should we do next",
      "bitte mit der arbeit weiter machen",
      "bitte fortfahren und mach weiter",
      "was sollen wir als nächstes tun",
    ]) {
      expect(selectProjectMemoryEntries(entries, query, 128_000).entries).toEqual([]);
    }
  });

  it("ignores tokens common across the document but keeps an exact stable key", () => {
    const entries = [
      entry("workflow.server-build", "The server uses the shared project runtime."),
      entry("workflow.server-test", "The server uses the shared focused tests."),
      entry("workflow.server-release", "The server uses the shared release path."),
    ];

    expect(selectProjectMemoryEntries(entries, "server shared", 128_000).entries).toEqual([]);
    expect(
      selectProjectMemoryEntries(entries, "workflow.server-test", 128_000).entries.map(
        (candidate) => candidate.key,
      ),
    ).toEqual(["workflow.server-test"]);
  });

  it("selects exact paths, symbols, and specific phrases without adjacent noise", () => {
    const entries = [
      entry("workflow.generic", "Run the usual focused test."),
      entry(
        "workflow.memory-selector",
        "Edit apps/server/src/projectMemory/ProjectMemoryDocument.ts in selectProjectMemoryEntries, then use an atomic rename.",
      ),
      entry("workflow.release", "Build the desktop release after verification."),
    ];

    for (const query of [
      "apps/server/src/projectMemory/ProjectMemoryDocument.ts",
      "selectProjectMemoryEntries",
      "atomic rename",
    ]) {
      expect(
        selectProjectMemoryEntries(entries, query, 128_000).entries.map(
          (candidate) => candidate.key,
        ),
      ).toEqual(["workflow.memory-selector"]);
    }
    expect(
      selectProjectMemoryEntries(
        entries.slice(0, 2),
        "selectProjectMemoryEntries",
        128_000,
      ).entries.map((candidate) => candidate.key),
    ).toEqual(["workflow.memory-selector"]);
  });
});
