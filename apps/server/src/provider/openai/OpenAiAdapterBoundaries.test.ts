import { describe, expect, it } from "@effect/vitest";

import * as Facade from "./OpenAiAdapter.ts";
import { normalizeOpenAiAdapterRoundEvent } from "./OpenAiAdapterEventNormalization.ts";
import { resolveOpenAiModel } from "./OpenAiAdapterModelPolicy.ts";
import {
  decodeOpenAiPersistedHistory,
  encodeOpenAiPersistedHistory,
} from "./OpenAiAdapterPersistence.ts";
import { buildOpenAiSystemInstructions } from "./OpenAiAdapterSystemPrompt.ts";
import { makeOpenAiAdapter } from "./OpenAiAdapterWiring.ts";

describe("OpenAI adapter module boundaries", () => {
  it("keeps the public adapter facade stable across focused modules", () => {
    expect(Facade.resolveOpenAiModel).toBe(resolveOpenAiModel);
    expect(Facade.normalizeOpenAiAdapterRoundEvent).toBe(normalizeOpenAiAdapterRoundEvent);
    expect(Facade.encodeOpenAiPersistedHistory).toBe(encodeOpenAiPersistedHistory);
    expect(Facade.decodeOpenAiPersistedHistory).toBe(decodeOpenAiPersistedHistory);
    expect(Facade.makeOpenAiAdapter).toBe(makeOpenAiAdapter);
  });

  it("keeps Fetch and plan instructions read-only at the prompt-policy boundary", () => {
    const instructions = buildOpenAiSystemInstructions({
      cwd: "/workspace",
      sandboxMode: "danger-full-access",
      interactionMode: "plan",
      fetchWorker: true,
    });

    expect(instructions).toContain("Read-only");
    expect(instructions).toContain("Plan mode is active");
    expect(instructions).toContain("/workspace");
    expect(instructions).toContain("workspace_find");
    expect(instructions).toContain("workspace_read");
    expect(instructions).toContain("workspace_context");
    expect(instructions).toContain(
      "Batch independent operations into the fewest calls; use workspace_context only for mixed search-and-read batches.",
    );
    expect(instructions).not.toContain("workspace_edit");
  });

  it("prefers the unified workspace editor for writable OpenAI sessions", () => {
    const instructions = buildOpenAiSystemInstructions({
      cwd: "/workspace",
      sandboxMode: "workspace-write",
      interactionMode: "default",
      fetchWorker: false,
    });

    expect(instructions).toContain("workspace_find");
    expect(instructions).toContain("workspace_read");
    expect(instructions).toContain("workspace_context");
    expect(instructions).toContain(
      "Batch independent operations into the fewest calls; use workspace_context only for mixed search-and-read batches.",
    );
    expect(instructions).toContain("workspace_edit");
    expect(instructions).toMatch(/formatters.*generators.*binaries/i);
  });
});
