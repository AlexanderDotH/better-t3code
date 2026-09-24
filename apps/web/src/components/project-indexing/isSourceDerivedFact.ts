import type { ProjectIndexProvenance } from "@t3tools/contracts";

export function isSourceDerivedFact(record: {
  readonly provenance: ProjectIndexProvenance;
}): boolean {
  return record.provenance === "parser" || record.provenance === "compiler";
}
