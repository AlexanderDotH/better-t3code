import { describe, expect, it } from "@effect/vitest";

import {
  renderGitRebasePlan,
  validateGitRebasePlan,
  validateGitRebasePlanTopology,
  type GitRebaseTodoNode,
} from "./GitRebasePlan.ts";

const OID_A = "a".repeat(40);
const OID_B = "b".repeat(40);
const OID_C = "c".repeat(40);

describe("GitRebasePlan", () => {
  it("renders a merge-preserving plan without shell syntax", () => {
    const nodes: readonly GitRebaseTodoNode[] = [
      { kind: "label", name: "onto-main" },
      { kind: "reword", oid: OID_A, message: "first\nignored" },
      { kind: "label", name: "feature-tip" },
      { kind: "reset", label: "onto-main" },
      { kind: "pick", oid: OID_B },
      {
        kind: "merge",
        label: "feature-tip",
        originalOid: OID_C,
        messageMode: "reuse",
      },
    ];

    expect(validateGitRebasePlan(nodes)).toEqual({ valid: true });
    expect(renderGitRebasePlan(nodes)).toBe(
      [
        "label onto-main",
        `reword ${OID_A} first ignored`,
        "label feature-tip",
        "reset onto-main",
        `pick ${OID_B}`,
        `merge -C ${OID_C} feature-tip`,
        "",
      ].join("\n"),
    );
  });

  it("rejects labels referenced before definition and duplicate labels", () => {
    const nodes: readonly GitRebaseTodoNode[] = [
      { kind: "reset", label: "future" },
      { kind: "label", name: "future" },
      { kind: "label", name: "future" },
    ];

    expect(validateGitRebasePlan(nodes)).toEqual({
      valid: false,
      issues: [
        { index: 0, code: "unknown_label", detail: "Label future is not defined yet." },
        { index: 2, code: "duplicate_label", detail: "Label future is already defined." },
      ],
    });
  });

  it("rejects invalid object ids and fold actions across topology boundaries", () => {
    const nodes: readonly GitRebaseTodoNode[] = [
      { kind: "squash", oid: "HEAD" },
      { kind: "pick", oid: OID_A },
      { kind: "label", name: "tip" },
      { kind: "label", name: "onto" },
      { kind: "reset", label: "onto" },
      { kind: "fixup", oid: OID_B },
    ];

    expect(validateGitRebasePlan(nodes)).toEqual({
      valid: false,
      issues: [
        { index: 0, code: "invalid_oid", detail: "Commit object id must be a full SHA." },
        {
          index: 0,
          code: "invalid_fold_target",
          detail: "squash requires a preceding commit in the same topology segment.",
        },
        {
          index: 5,
          code: "invalid_fold_target",
          detail: "fixup requires a preceding commit in the same topology segment.",
        },
      ],
    });
  });

  it("rejects unsafe labels and subjects cannot inject todo commands", () => {
    const nodes: readonly GitRebaseTodoNode[] = [
      { kind: "label", name: "bad label" },
      { kind: "reword", oid: OID_A, message: "safe\nexec curl example.invalid" },
    ];

    expect(validateGitRebasePlan(nodes)).toEqual({
      valid: false,
      issues: [
        {
          index: 0,
          code: "invalid_label",
          detail: "Label names may contain only letters, numbers, dot, underscore, and dash.",
        },
      ],
    });
    expect(renderGitRebasePlan(nodes)).toContain(`reword ${OID_A} safe exec curl example.invalid`);
  });

  it("rejects unrelated commits, dependency reordering, and changed merge parents", () => {
    const upstream = "d".repeat(40);
    const graph = [
      { oid: OID_A, parents: [upstream] },
      { oid: OID_B, parents: [upstream] },
      { oid: OID_C, parents: [OID_A, OID_B] },
    ];
    const valid = [
      { kind: "label", name: "onto" },
      { kind: "pick", oid: OID_A },
      { kind: "label", name: "main-tip" },
      { kind: "reset", label: "onto" },
      { kind: "pick", oid: OID_B },
      { kind: "label", name: "side-tip" },
      { kind: "reset", label: "main-tip" },
      { kind: "merge", label: "side-tip", originalOid: OID_C, messageMode: "reuse" },
    ] as const satisfies readonly GitRebaseTodoNode[];

    expect(validateGitRebasePlanTopology(valid, graph, upstream)).toEqual({ valid: true });
    const reordered = validateGitRebasePlanTopology(
      [
        { kind: "pick", oid: OID_B },
        { kind: "pick", oid: OID_A },
      ],
      [
        { oid: OID_A, parents: [upstream] },
        { oid: OID_B, parents: [OID_A] },
      ],
      upstream,
    );
    const unrelated = validateGitRebasePlanTopology(
      [...valid.slice(0, -1), { kind: "pick", oid: "e".repeat(40) }],
      graph,
      upstream,
    );
    const changedMerge = validateGitRebasePlanTopology(
      [
        ...valid.slice(0, -1),
        { kind: "merge", label: "main-tip", originalOid: OID_C, messageMode: "reuse" },
      ],
      graph,
      upstream,
    );

    expect(reordered.valid).toBe(false);
    expect(unrelated.valid).toBe(false);
    expect(changedMerge.valid).toBe(false);
    if (reordered.valid || unrelated.valid || changedMerge.valid) return;
    expect(reordered.issues.some(({ code }) => code === "dependency_order")).toBe(true);
    expect(unrelated.issues.some(({ code }) => code === "unknown_commit")).toBe(true);
    expect(changedMerge.issues.some(({ code }) => code === "merge_topology")).toBe(true);
  });
});
