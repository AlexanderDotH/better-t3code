import type {
  EnvironmentApi,
  OrchestrationThreadTranscriptExport,
  ThreadId,
} from "@t3tools/contracts";

type ExportThreadTranscript = EnvironmentApi["orchestration"]["exportThreadTranscript"];

export async function copyThreadTranscript(input: {
  readonly threadId: ThreadId;
  readonly exportThreadTranscript: ExportThreadTranscript;
  readonly writeText: (content: string) => Promise<void>;
}): Promise<OrchestrationThreadTranscriptExport> {
  const transcript = await input.exportThreadTranscript({ threadId: input.threadId });
  await input.writeText(transcript.content);
  return transcript;
}
