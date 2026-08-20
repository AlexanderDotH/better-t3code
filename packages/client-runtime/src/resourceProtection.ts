import type { ResourceProtectionSnapshot, ThreadId } from "@t3tools/contracts";

export interface ResourceProtectionPresentation {
  readonly kind: "waiting" | "throttled";
  readonly label: string;
  readonly description: string;
}

export function resolveResourceProtectionPresentation(
  snapshot: ResourceProtectionSnapshot | null | undefined,
  threadId: ThreadId | null | undefined,
): ResourceProtectionPresentation | null {
  if (!snapshot || !threadId || !snapshot.affectedThreadIds.includes(threadId)) return null;

  switch (snapshot.state) {
    case "waiting":
      return {
        kind: "waiting",
        label: "Subagent wartet auf freien Speicher",
        description: "Der Start wird automatisch fortgesetzt; Stoppen bleibt jederzeit möglich.",
      };
    case "throttled":
    case "recovering":
      return {
        kind: "throttled",
        label: "Provider vorübergehend gedrosselt",
        description:
          snapshot.state === "recovering"
            ? "Die Speicherreserve stabilisiert sich; T3 setzt den Provider automatisch fort."
            : "T3 setzt den Provider nach fünf gesunden Speichermessungen automatisch fort.",
      };
    case "normal":
      return null;
    case "unavailable":
      return snapshot.waitingStarts > 0
        ? {
            kind: "waiting",
            label: "Subagent wartet auf freien Speicher",
            description:
              "Der Start wird fortgesetzt, sobald T3 den verfügbaren Speicher wieder sicher messen kann; Stoppen bleibt möglich.",
          }
        : {
            kind: "throttled",
            label: "Provider vorübergehend gedrosselt",
            description:
              "T3 setzt den Provider fort, sobald der verfügbare Speicher wieder sicher messbar ist.",
          };
  }
}
