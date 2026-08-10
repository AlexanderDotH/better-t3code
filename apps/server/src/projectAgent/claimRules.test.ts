import type { ProjectAgentClaim } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";

import { findProjectAgentClaimConflicts, normalizeProjectAgentClaims } from "./claimRules.ts";

it("normalizes logical paths and topic keys", () => {
  expect(
    normalizeProjectAgentClaims(
      [
        { kind: "path", path: "src//server/./mcp/" },
        { kind: "topic", topic: "  Database   Migration  " },
        { kind: "topic", topic: "database migration" },
      ],
      { caseInsensitivePaths: false },
    ),
  ).toEqual([
    { kind: "path", path: "src/server/mcp" },
    { kind: "topic", topic: "database migration" },
  ]);
});

it.each(["/etc/passwd", "../outside", "src/../outside", "C:/repo", "src\\server", "src/*"])(
  "rejects unsafe project claim path %s",
  (path) => {
    expect(() =>
      normalizeProjectAgentClaims([{ kind: "path", path }], {
        caseInsensitivePaths: false,
      }),
    ).toThrow();
  },
);

it("detects exact, ancestor, whole-project, and normalized topic conflicts", () => {
  const existing: ReadonlyArray<ProjectAgentClaim> = [
    { kind: "path", path: "src/server" },
    { kind: "topic", topic: "database migration" },
  ];
  const requested: ReadonlyArray<ProjectAgentClaim> = [
    { kind: "path", path: "src/server/mcp" },
    { kind: "path", path: "docs" },
    { kind: "topic", topic: "database migration" },
  ];

  expect(findProjectAgentClaimConflicts(requested, existing)).toEqual([
    {
      requested: { kind: "path", path: "src/server/mcp" },
      existing: { kind: "path", path: "src/server" },
    },
    {
      requested: { kind: "topic", topic: "database migration" },
      existing: { kind: "topic", topic: "database migration" },
    },
  ]);
  expect(findProjectAgentClaimConflicts([{ kind: "path", path: "." }], existing)).toHaveLength(1);
  expect(findProjectAgentClaimConflicts([{ kind: "path", path: "src/web" }], existing)).toEqual([]);
});

it("case-folds paths only on case-insensitive platforms", () => {
  expect(
    normalizeProjectAgentClaims([{ kind: "path", path: "Src/Server" }], {
      caseInsensitivePaths: true,
    }),
  ).toEqual([{ kind: "path", path: "src/server" }]);
  expect(
    normalizeProjectAgentClaims([{ kind: "path", path: "Src/Server" }], {
      caseInsensitivePaths: false,
    }),
  ).toEqual([{ kind: "path", path: "Src/Server" }]);
});
