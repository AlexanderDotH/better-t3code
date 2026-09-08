import type { ProjectSpeechProfile, T3ChatImportRunResult } from "@t3tools/contracts";

export function formatCountLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatChatImportLatest(value: string | null): string {
  if (value === null) return "No dated chats";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `Latest chat ${date.toLocaleString()}`;
}

export function formatChatImportSummary(result: T3ChatImportRunResult): string {
  const base = `Synced ${formatCountLabel(result.threadsImported, "chat")} and ${formatCountLabel(
    result.messagesImported,
    "message",
  )} from ${formatCountLabel(result.projectsImported, "project")}.`;
  if (result.attachmentsCopied === 0 && result.attachmentsSkipped === 0) return base;
  return `${base} ${formatCountLabel(result.attachmentsCopied, "attachment")} copied${
    result.attachmentsSkipped > 0
      ? `, ${formatCountLabel(result.attachmentsSkipped, "attachment")} unavailable`
      : ""
  }.`;
}

export type SpeechProfileLoadState = "loading" | "ready" | "error";
export type SpeechProfileStatus =
  | "Loading"
  | "Indexed"
  | "Basic context"
  | "Not indexed"
  | "Unavailable";

export function projectSpeechProfileStatus(
  profile: Pick<ProjectSpeechProfile, "source"> | undefined,
  loadState: SpeechProfileLoadState,
): SpeechProfileStatus {
  if (profile?.source === "indexed") return "Indexed";
  if (profile?.source === "basic") return "Basic context";
  if (loadState === "error") return "Unavailable";
  if (loadState === "loading") return "Loading";
  return "Not indexed";
}
