import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  SkillCreateInput,
  SkillDescriptor,
  SkillDiscoverImportSourcesResult,
  SkillImportSourcesInput,
  SkillTarget,
} from "./skills.ts";

const decodeSkillDescriptor = Schema.decodeUnknownSync(SkillDescriptor);
const decodeSkillCreateInput = Schema.decodeUnknownSync(SkillCreateInput);
const decodeSkillDiscoverImportSourcesResult = Schema.decodeUnknownSync(
  SkillDiscoverImportSourcesResult,
);
const decodeSkillImportSourcesInput = Schema.decodeUnknownSync(SkillImportSourcesInput);
const decodeSkillTarget = Schema.decodeUnknownSync(SkillTarget);

describe("Skill contracts", () => {
  it("decodes provider-neutral skill descriptors", () => {
    const skill = decodeSkillDescriptor({
      id: "global:/tmp/t3/skills/review/SKILL.md",
      name: "review",
      path: "/tmp/t3/skills/review/SKILL.md",
      scope: "global",
      enabled: true,
      readOnly: false,
    });

    expect(skill.providerInstanceId).toBeUndefined();
    expect(skill.providerDriver).toBeUndefined();
    expect(skill.providerSupport).toEqual([]);
  });

  it("keeps providerInstanceId optional on mutations for older clients", () => {
    expect(
      decodeSkillCreateInput({
        scope: "global",
        name: "review",
        description: "Review changed code.",
        body: "# Guidance\n",
      }).providerInstanceId,
    ).toBeUndefined();

    expect(
      decodeSkillTarget({
        scope: "global",
        name: "review",
      }).providerInstanceId,
    ).toBeUndefined();
  });

  it("decodes discovered agent dotfolders and skill import selections", () => {
    const sources = decodeSkillDiscoverImportSourcesResult({
      sources: [
        {
          id: "cursor:/home/alex/.cursor",
          tool: "cursor",
          label: "Cursor .cursor",
          path: "/home/alex/.cursor",
          mcpServerCount: 1,
          skillCount: 3,
          mcpConfigPaths: ["/home/alex/.cursor/mcp.json"],
          skillPaths: ["/home/alex/.cursor/skills/review/SKILL.md"],
        },
      ],
    });

    expect(sources.sources[0]?.skillCount).toBe(3);
    expect(
      decodeSkillImportSourcesInput({
        sourceIds: ["cursor:/home/alex/.cursor"],
        scope: "global",
      }),
    ).toMatchObject({
      sourceIds: ["cursor:/home/alex/.cursor"],
      deduplicate: true,
    });
  });
});
