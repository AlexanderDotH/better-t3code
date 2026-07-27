import type {
  OrchestrationProject,
  OrchestrationProjectShell,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationThreadTranscriptExport,
} from "@t3tools/contracts";

const FORMAT_VERSION = 1 as const;
const MEDIA_TYPE = "text/markdown" as const;

interface RenderThreadTranscriptInput {
  readonly thread: OrchestrationThread;
  readonly project: OrchestrationProject | OrchestrationProjectShell;
  readonly generatedAt: string;
}

type TimelineEntry =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly createdAt: string;
      readonly sequence: number;
      readonly value: OrchestrationThread["messages"][number];
    }
  | {
      readonly kind: "activity";
      readonly id: string;
      readonly createdAt: string;
      readonly sequence: number;
      readonly value: OrchestrationThreadActivity;
    };

function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/gu, "");
  return slug.length > 0 ? slug : fallback;
}

function compactTimestamp(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/u.exec(value);
  return match
    ? `${match[1]}${match[2]}${match[3]}-${match[4]}${match[5]}${match[6]}`
    : "unknown-time";
}

function makeFileName(thread: OrchestrationThread, generatedAt: string): string {
  return `${slugify(thread.title, "chat")}-${slugify(thread.id, "thread")}-${compactTimestamp(generatedAt)}.md`;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    if (character === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function codeFence(value: string, language = ""): string {
  const marker = "`".repeat(Math.max(3, longestBacktickRun(value) + 1));
  return `${marker}${language}\n${value}\n${marker}`;
}

function prettyJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? String(value) : serialized;
}

function jsonBlock(value: unknown): string {
  return codeFence(prettyJson(value), "json");
}

function yamlString(value: unknown): string {
  return JSON.stringify(value);
}

function timelineEntries(thread: OrchestrationThread): TimelineEntry[] {
  const messages: TimelineEntry[] = thread.messages.map((value) => ({
    kind: "message",
    id: value.id,
    createdAt: value.createdAt,
    sequence: Number.MAX_SAFE_INTEGER,
    value,
  }));
  const activities: TimelineEntry[] = thread.activities.map((value) => ({
    kind: "activity",
    id: value.id,
    createdAt: value.createdAt,
    sequence: value.sequence ?? Number.MAX_SAFE_INTEGER,
    value,
  }));
  return [...messages, ...activities].toSorted((left, right) => {
    const timestampOrder = left.createdAt.localeCompare(right.createdAt);
    if (timestampOrder !== 0) return timestampOrder;
    const sequenceOrder = left.sequence - right.sequence;
    if (sequenceOrder !== 0) return sequenceOrder;
    return left.id.localeCompare(right.id);
  });
}

function roleLabel(role: OrchestrationThread["messages"][number]["role"]): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
  }
}

function renderMessage(entry: Extract<TimelineEntry, { kind: "message" }>): string {
  const message = entry.value;
  const metadata = {
    id: message.id,
    turnId: message.turnId,
    streaming: message.streaming,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
  };
  const parts = [
    `### ${message.createdAt} · ${roleLabel(message.role)}`,
    "",
    message.text.length > 0 ? codeFence(message.text, "markdown") : "_(empty message)_",
    "",
    "<details>",
    "<summary>Message metadata</summary>",
    "",
    jsonBlock(metadata),
    "",
    "</details>",
  ];
  return parts.join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function activityLabel(activity: OrchestrationThreadActivity): string {
  if (activity.kind.startsWith("reasoning.")) return "Thinking / reasoning";
  if (activity.tone === "tool") return `Tool · ${activity.summary}`;
  if (activity.tone === "error") return `Error · ${activity.summary}`;
  return activity.summary;
}

function renderActivity(entry: Extract<TimelineEntry, { kind: "activity" }>): string {
  const activity = entry.value;
  const payload = asRecord(activity.payload);
  const reasoningText =
    activity.kind.startsWith("reasoning.") && typeof payload?.text === "string"
      ? payload.text
      : null;
  const metadata = {
    id: activity.id,
    kind: activity.kind,
    tone: activity.tone,
    turnId: activity.turnId,
    sequence: activity.sequence ?? null,
    createdAt: activity.createdAt,
    payload: activity.payload,
  };
  const parts = [`### ${activity.createdAt} · ${activityLabel(activity)}`, ""];
  if (reasoningText !== null) {
    parts.push(
      "<details open>",
      "<summary>Provider-emitted reasoning</summary>",
      "",
      codeFence(reasoningText, "text"),
      "",
      "</details>",
      "",
    );
  }
  parts.push(
    "<details>",
    "<summary>Complete stored activity</summary>",
    "",
    jsonBlock(metadata),
    "",
    "</details>",
  );
  return parts.join("\n");
}

function renderConversation(thread: OrchestrationThread): string {
  const entries = timelineEntries(thread);
  if (entries.length === 0) return "_(No stored messages or activities.)_";
  return entries
    .map((entry) => (entry.kind === "message" ? renderMessage(entry) : renderActivity(entry)))
    .join("\n\n---\n\n");
}

function renderPlans(thread: OrchestrationThread): string {
  if (thread.proposedPlans.length === 0) return "_(No proposed plans.)_";
  return thread.proposedPlans
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
    .map((plan) =>
      [
        `### Plan ${plan.id}`,
        "",
        codeFence(plan.planMarkdown, "markdown"),
        "",
        "<details>",
        "<summary>Plan metadata</summary>",
        "",
        jsonBlock({ ...plan, planMarkdown: undefined }),
        "",
        "</details>",
      ].join("\n"),
    )
    .join("\n\n");
}

function renderCheckpoints(thread: OrchestrationThread): string {
  if (thread.checkpoints.length === 0) return "_(No checkpoints.)_";
  return thread.checkpoints
    .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
    .map(
      (checkpoint) =>
        `### Checkpoint ${checkpoint.checkpointTurnCount}\n\n${jsonBlock(checkpoint)}`,
    )
    .join("\n\n");
}

export function renderThreadTranscriptMarkdown(
  input: RenderThreadTranscriptInput,
): OrchestrationThreadTranscriptExport {
  const { thread, project, generatedAt } = input;
  const fileName = makeFileName(thread, generatedAt);
  const frontMatter = [
    "---",
    `format: ${yamlString("t3code-chat-transcript")}`,
    `format_version: ${FORMAT_VERSION}`,
    `file_name: ${yamlString(fileName)}`,
    `suggested_filename: ${yamlString(fileName)}`,
    `thread_id: ${yamlString(thread.id)}`,
    `thread_title: ${yamlString(thread.title)}`,
    `project_id: ${yamlString(project.id)}`,
    `project_title: ${yamlString(project.title)}`,
    `project_workspace_root: ${yamlString(project.workspaceRoot)}`,
    `provider_instance_id: ${yamlString(thread.modelSelection.instanceId)}`,
    `model: ${yamlString(thread.modelSelection.model)}`,
    `branch: ${yamlString(thread.branch)}`,
    `worktree_path: ${yamlString(thread.worktreePath)}`,
    `thread_created_at: ${yamlString(thread.createdAt)}`,
    `thread_updated_at: ${yamlString(thread.updatedAt)}`,
    `generated_at: ${yamlString(generatedAt)}`,
    "---",
  ].join("\n");
  const threadMetadata = {
    thread: {
      id: thread.id,
      title: thread.title,
      projectId: thread.projectId,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      latestTurn: thread.latestTurn,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: thread.archivedAt,
      deletedAt: thread.deletedAt,
    },
    project,
  };
  const content = [
    frontMatter,
    "",
    `# ${thread.title}`,
    "",
    "> **Warning:** This transcript is unredacted. It may contain secrets, source code, file contents, tool inputs, and tool results.",
    "",
    "## Thread metadata",
    "",
    jsonBlock(threadMetadata),
    "",
    "## Session metadata",
    "",
    jsonBlock({ latestTurn: thread.latestTurn, session: thread.session }),
    "",
    "## Conversation",
    "",
    renderConversation(thread),
    "",
    "## Proposed plans",
    "",
    renderPlans(thread),
    "",
    "## Checkpoints",
    "",
    renderCheckpoints(thread),
    "",
  ].join("\n");
  return {
    formatVersion: FORMAT_VERSION,
    fileName,
    mediaType: MEDIA_TYPE,
    generatedAt,
    content,
  };
}
