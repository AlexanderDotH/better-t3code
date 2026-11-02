import type { OrchestrationV2ThreadTranscript, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export interface CopiedThreadTranscript {
  readonly fileName: string;
  readonly content: string;
}

export async function copyThreadTranscript(input: {
  readonly threadId: ThreadId;
  readonly exportThreadTranscript: (input: {
    readonly threadId: ThreadId;
  }) => Promise<OrchestrationV2ThreadTranscript>;
  readonly writeText: (content: string) => Promise<void>;
}): Promise<CopiedThreadTranscript> {
  const transcript = await input.exportThreadTranscript({ threadId: input.threadId });
  const sections = transcript.items.map(({ item }) => {
    const heading = item.type.replaceAll("_", " ");
    if ("text" in item && typeof item.text === "string") {
      const attachments =
        "attachments" in item && item.attachments !== undefined && item.attachments.length > 0
          ? `\n\nAttachments:\n\n${JSON.stringify(item.attachments, null, 2)}`
          : "";
      return `## ${heading}\n\n${item.text}${attachments}`;
    }
    return `## ${heading}\n\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``;
  });
  const copied = {
    fileName: `${transcript.title.replace(/[^\p{L}\p{N}._ -]/gu, "_") || "Thread"}.md`,
    content: `# ${transcript.title}\n\nUpdated: ${DateTime.formatIso(transcript.updatedAt)}\n\n${sections.join("\n\n")}\n`,
  };
  await input.writeText(copied.content);
  return copied;
}
