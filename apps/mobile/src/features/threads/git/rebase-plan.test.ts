import { describe, expect, it } from "vite-plus/test";
import { isValidRebasePlan } from "./rebase-plan";

describe("mobile interactive rebase validation", () => {
  it("keeps topology labels in scope and requires a commit before squash or fixup", () => {
    const oid = "a".repeat(40);
    expect(
      isValidRebasePlan([
        { kind: "pick", oid },
        { kind: "fixup", oid: "b".repeat(40) },
      ]),
    ).toBe(true);
    expect(
      isValidRebasePlan([
        { kind: "reset", label: "onto" },
        { kind: "pick", oid },
      ]),
    ).toBe(true);
    expect(isValidRebasePlan([{ kind: "fixup", oid }])).toBe(false);
    expect(isValidRebasePlan([{ kind: "reset", label: "missing" }])).toBe(false);
    expect(
      isValidRebasePlan([
        { kind: "label", name: "branch" },
        { kind: "label", name: "branch" },
      ]),
    ).toBe(false);
    expect(
      isValidRebasePlan([
        { kind: "merge", label: "future", originalOid: oid, messageMode: "reuse" },
        { kind: "label", name: "future" },
      ]),
    ).toBe(false);
    expect(isValidRebasePlan([{ kind: "reword", oid, message: " " }])).toBe(false);
    expect(
      isValidRebasePlan(
        [
          { kind: "pick", oid: "b".repeat(40) },
          { kind: "pick", oid },
        ],
        new Map([["b".repeat(40), [oid]]]),
      ),
    ).toBe(false);
  });
});
