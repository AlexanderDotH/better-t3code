import type { GitRebaseTodoNode } from "@t3tools/contracts";

export function isValidRebasePlan(
  nodes: ReadonlyArray<GitRebaseTodoNode>,
  parents?: ReadonlyMap<string, ReadonlyArray<string>>,
): boolean {
  const labels = new Set(["onto"]);
  const positions = new Map(
    nodes.flatMap((node, index) => ("oid" in node ? [[node.oid, index] as const] : [])),
  );
  let hasPreviousCommit = false;
  if (!nodes.length) return false;
  for (const [index, node] of nodes.entries()) {
    if (
      "oid" in node &&
      parents?.get(node.oid)?.some((parent) => (positions.get(parent) ?? -1) >= index)
    )
      return false;
    if (node.kind === "label") {
      if (labels.has(node.name)) return false;
      labels.add(node.name);
    } else if (node.kind === "reset") {
      if (!labels.has(node.label)) return false;
      hasPreviousCommit = false;
    } else if (node.kind === "merge") {
      if (!labels.has(node.label)) return false;
      hasPreviousCommit = true;
    } else {
      if ((node.kind === "squash" || node.kind === "fixup") && !hasPreviousCommit) return false;
      if (node.kind === "reword" && !node.message?.trim()) return false;
      if (node.kind !== "drop") hasPreviousCommit = true;
    }
  }
  return true;
}
