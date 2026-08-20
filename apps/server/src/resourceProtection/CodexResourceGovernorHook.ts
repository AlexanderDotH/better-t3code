import * as NodeStream from "node:stream";
import * as Effect from "effect/Effect";

export const RESOURCE_PROTECTION_URL_ENV = "T3_RESOURCE_PROTECTION_URL";
export const RESOURCE_PROTECTION_TOKEN_ENV = "T3_MCP_BEARER_TOKEN";
export const RESOURCE_PROTECTION_CONFIGURATION_ENV = "T3_RESOURCE_PROTECTION_CONFIGURATION";

const MAX_HOOK_INPUT_BYTES = 64 * 1024;
const RETRY_DELAY_MS = 250;
const LIFECYCLE_RETRY_ATTEMPTS = 40;
const LIFECYCLE_HOOK_TIMEOUT_SECONDS = 15;
const EFFECTIVELY_UNBOUNDED_HOOK_TIMEOUT_SECONDS = 365 * 24 * 60 * 60;

function quotePosixArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quoteWindowsArgument(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function codexResourceGovernorHookLaunchConfiguration(input: {
  readonly executablePath?: string;
  readonly serverEntryPath?: string;
}) {
  const executablePath = input.executablePath ?? process.execPath;
  const serverEntryPath = input.serverEntryPath ?? process.argv[1];
  if (!serverEntryPath) return undefined;
  const command = `${quotePosixArgument(executablePath)} ${quotePosixArgument(serverEntryPath)} resource-governor-hook`;
  const commandWindows = `${quoteWindowsArgument(executablePath)} ${quoteWindowsArgument(serverEntryPath)} resource-governor-hook`;
  const override = (input: {
    readonly event: "PreToolUse" | "UserPromptSubmit" | "Stop" | "SubagentStart" | "SubagentStop";
    readonly matcher?: string;
    readonly timeout: number;
    readonly statusMessage: string;
  }) =>
    `hooks.${input.event}=[{${input.matcher ? `matcher=${JSON.stringify(input.matcher)},` : ""}hooks=[{type="command",command=${JSON.stringify(command)},command_windows=${JSON.stringify(commandWindows)},timeout=${input.timeout},status_message=${JSON.stringify(input.statusMessage)}}]}]`;
  const overrides = [
    override({
      event: "PreToolUse",
      matcher: "^(spawn_agent|Agent)$",
      timeout: EFFECTIVELY_UNBOUNDED_HOOK_TIMEOUT_SECONDS,
      statusMessage: "Subagent wartet auf freien Speicher",
    }),
    override({
      event: "UserPromptSubmit",
      timeout: EFFECTIVELY_UNBOUNDED_HOOK_TIMEOUT_SECONDS,
      statusMessage: "Agent wartet auf freien Speicher",
    }),
    override({
      event: "Stop",
      timeout: LIFECYCLE_HOOK_TIMEOUT_SECONDS,
      statusMessage: "Speicherreservierung wird freigegeben",
    }),
    override({
      event: "SubagentStart",
      timeout: LIFECYCLE_HOOK_TIMEOUT_SECONDS,
      statusMessage: "Subagent-Speicher wird reserviert",
    }),
    override({
      event: "SubagentStop",
      timeout: LIFECYCLE_HOOK_TIMEOUT_SECONDS,
      statusMessage: "Subagent-Speicher wird freigegeben",
    }),
  ];
  return {
    globalArgs: ["--dangerously-bypass-hook-trust"],
    appServerArgs: overrides.flatMap((entry) => ["-c", entry]),
  } as const;
}

async function readHookInput(input: NodeStream.Readable): Promise<{
  readonly parsed: unknown;
  readonly metadataFragments: string;
}> {
  const chunks: Array<Buffer> = [];
  let retainedBytes = 0;
  let observedBytes = 0;
  const tail = Buffer.allocUnsafe(MAX_HOOK_INPUT_BYTES);
  let tailBytes = 0;
  let tailOffset = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    observedBytes += buffer.byteLength;
    if (retainedBytes < MAX_HOOK_INPUT_BYTES) {
      const retained = buffer.subarray(0, MAX_HOOK_INPUT_BYTES - retainedBytes);
      chunks.push(retained);
      retainedBytes += retained.byteLength;
    }

    if (buffer.byteLength >= MAX_HOOK_INPUT_BYTES) {
      buffer.copy(tail, 0, buffer.byteLength - MAX_HOOK_INPUT_BYTES);
      tailBytes = MAX_HOOK_INPUT_BYTES;
      tailOffset = 0;
      continue;
    }
    const beforeWrap = Math.min(buffer.byteLength, MAX_HOOK_INPUT_BYTES - tailOffset);
    buffer.copy(tail, tailOffset, 0, beforeWrap);
    if (beforeWrap < buffer.byteLength) {
      buffer.copy(tail, 0, beforeWrap);
    }
    tailOffset = (tailOffset + buffer.byteLength) % MAX_HOOK_INPUT_BYTES;
    tailBytes = Math.min(MAX_HOOK_INPUT_BYTES, tailBytes + buffer.byteLength);
  }

  const head = Buffer.concat(chunks).toString("utf8");
  const tailFragment =
    tailBytes < MAX_HOOK_INPUT_BYTES
      ? tail.subarray(0, tailBytes).toString("utf8")
      : Buffer.concat([tail.subarray(tailOffset), tail.subarray(0, tailOffset)]).toString("utf8");
  try {
    return {
      parsed: observedBytes <= MAX_HOOK_INPUT_BYTES ? JSON.parse(head) : undefined,
      metadataFragments: observedBytes <= MAX_HOOK_INPUT_BYTES ? head : `${head}\n${tailFragment}`,
    };
  } catch {
    return { parsed: undefined, metadataFragments: `${head}\n${tailFragment}` };
  }
}

function extractJsonStringField(
  input: string,
  field: "hook_event_name" | "turn_id" | "tool_name" | "tool_use_id" | "agent_id",
): string | undefined {
  const encoded = new RegExp(`"${field}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`, "u").exec(input)?.[1];
  if (!encoded) return undefined;
  try {
    const decoded = JSON.parse(encoded) as unknown;
    return typeof decoded === "string" ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function recoverHookInput(input: string): HookInput {
  return {
    hook_event_name: extractJsonStringField(input, "hook_event_name"),
    turn_id: extractJsonStringField(input, "turn_id"),
    tool_name: extractJsonStringField(input, "tool_name"),
    tool_use_id: extractJsonStringField(input, "tool_use_id"),
    agent_id: extractJsonStringField(input, "agent_id"),
  };
}

function hookDecision(permissionDecision: "allow" | "deny", reason?: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      ...(reason ? { permissionDecisionReason: reason } : {}),
    },
  });
}

function promptDecision(reason: string): string {
  return JSON.stringify({ decision: "block", reason });
}

interface HookInput {
  readonly hook_event_name?: unknown;
  readonly turn_id?: unknown;
  readonly tool_name?: unknown;
  readonly tool_use_id?: unknown;
  readonly agent_id?: unknown;
}

export interface CodexResourceGovernorHookOptions {
  readonly input?: NodeStream.Readable;
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetch?: typeof globalThis.fetch;
  readonly write?: (value: string) => void;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/** Synchronous Codex lifecycle hook for root turns and native subagents. */
export async function runCodexResourceGovernorHook(
  options: CodexResourceGovernorHookOptions = {},
): Promise<void> {
  const input = options.input ?? process.stdin;
  const environment = options.environment ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const write = options.write ?? ((value: string) => process.stdout.write(`${value}\n`));
  const wait =
    options.wait ?? ((milliseconds: number) => Effect.runPromise(Effect.sleep(milliseconds)));
  const hookInputRead = await readHookInput(input);
  const hookInput =
    typeof hookInputRead.parsed === "object" && hookInputRead.parsed !== null
      ? (hookInputRead.parsed as HookInput)
      : recoverHookInput(hookInputRead.metadataFragments);
  const hookEventName = hookInput.hook_event_name;

  if (hookEventName === "PreToolUse") {
    if (hookInput.tool_name !== "spawn_agent" && hookInput.tool_name !== "Agent") {
      write(hookDecision("allow"));
      return;
    }
  } else if (
    hookEventName !== "UserPromptSubmit" &&
    hookEventName !== "Stop" &&
    hookEventName !== "SubagentStart" &&
    hookEventName !== "SubagentStop"
  ) {
    write(hookDecision("deny", "T3 resource protection received an invalid hook event."));
    return;
  }

  const url = environment[RESOURCE_PROTECTION_URL_ENV];
  const token = environment[RESOURCE_PROTECTION_TOKEN_ENV];
  const configurationKey = environment[RESOURCE_PROTECTION_CONFIGURATION_ENV] ?? "codex:unknown";
  if (!url || !token || !fetchImpl) {
    if (
      hookEventName === "Stop" ||
      hookEventName === "SubagentStart" ||
      hookEventName === "SubagentStop"
    ) {
      write("{}");
      return;
    }
    write(
      hookEventName === "UserPromptSubmit"
        ? promptDecision("T3 resource protection is unavailable; the turn was not started.")
        : hookDecision(
            "deny",
            "T3 resource protection is unavailable; the subagent was not started.",
          ),
    );
    return;
  }

  const lifecycleId =
    hookEventName === "PreToolUse"
      ? hookInput.tool_use_id
      : hookEventName === "UserPromptSubmit" || hookEventName === "Stop"
        ? hookInput.turn_id
        : hookInput.agent_id;
  if (typeof lifecycleId !== "string" || lifecycleId.length === 0) {
    if (
      hookEventName === "Stop" ||
      hookEventName === "SubagentStart" ||
      hookEventName === "SubagentStop"
    ) {
      write("{}");
      return;
    }
    write(
      hookEventName === "UserPromptSubmit"
        ? promptDecision("T3 resource protection could not identify this turn.")
        : hookDecision("deny", "T3 resource protection could not identify this subagent start."),
    );
    return;
  }

  const body =
    hookEventName === "PreToolUse"
      ? {
          action: "admit-subagent",
          configurationKey,
          lifecycleId,
        }
      : hookEventName === "UserPromptSubmit"
        ? {
            action: "admit-root-turn",
            configurationKey,
            lifecycleId,
          }
        : hookEventName === "Stop"
          ? { action: "release-root-turn", lifecycleId }
          : hookEventName === "SubagentStart"
            ? { action: "confirm-subagent", configurationKey, agentId: lifecycleId }
            : { action: "release-subagent", agentId: lifecycleId };
  const admission = hookEventName === "PreToolUse" || hookEventName === "UserPromptSubmit";
  const attempts = admission ? Number.POSITIVE_INFINITY : LIFECYCLE_RETRY_ATTEMPTS;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        if (!admission) {
          write("{}");
          return;
        }
        const result = (await response.json().catch(() => undefined)) as
          | { readonly admitted?: unknown }
          | undefined;
        const denied = result?.admitted === false;
        write(
          hookEventName === "UserPromptSubmit"
            ? denied
              ? promptDecision("The turn start was cancelled.")
              : "{}"
            : denied
              ? hookDecision("deny", "The subagent start was cancelled.")
              : hookDecision("allow"),
        );
        return;
      }
      if (response.status === 409) {
        write(
          hookEventName === "UserPromptSubmit"
            ? promptDecision("The turn start was cancelled.")
            : hookEventName === "PreToolUse"
              ? hookDecision("deny", "The subagent start was cancelled.")
              : "{}",
        );
        return;
      }
      if (response.status === 401 || response.status === 403) {
        write(
          hookEventName === "UserPromptSubmit"
            ? promptDecision(
                "T3 resource protection credentials are invalid; the turn was not started.",
              )
            : hookEventName === "PreToolUse"
              ? hookDecision(
                  "deny",
                  "T3 resource protection credentials are invalid; the subagent was not started.",
                )
              : "{}",
        );
        return;
      }
    } catch {
      // A rolling server handoff may briefly close the loopback endpoint.
      // Keep the visible hook pending; Codex cancellation still kills us.
    }
    if (attempt < attempts) await wait(RETRY_DELAY_MS);
  }
  write("{}");
}
