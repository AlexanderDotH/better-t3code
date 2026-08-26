import type { CanonicalItemType } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type {
  NativeHarnessToolDeclaration,
  NativeHarnessToolExtension,
  NativeHarnessToolResult,
} from "../provider/nativeHarness/NativeHarnessTools.ts";
import {
  GeneralSubagentCoordinator,
  type GeneralSubagentCaller,
} from "./GeneralSubagentCoordinator.ts";
import {
  GeneralSubagentFollowUpInput,
  GeneralSubagentInterruptInput,
  GeneralSubagentListInput,
  GeneralSubagentSendMessageInput,
  GeneralSubagentSpawnInput,
  GeneralSubagentWaitInput,
} from "./GeneralSubagentProtocol.ts";

const decodeListInput = Schema.decodeUnknownEffect(GeneralSubagentListInput);
const decodeSpawnInput = Schema.decodeUnknownEffect(GeneralSubagentSpawnInput);
const decodeSendMessageInput = Schema.decodeUnknownEffect(GeneralSubagentSendMessageInput);
const decodeFollowUpInput = Schema.decodeUnknownEffect(GeneralSubagentFollowUpInput);
const decodeWaitInput = Schema.decodeUnknownEffect(GeneralSubagentWaitInput);
const decodeInterruptInput = Schema.decodeUnknownEffect(GeneralSubagentInterruptInput);

function declaration(
  name: string,
  description: string,
  schema: Schema.Top,
  availability: NativeHarnessToolDeclaration["availability"],
): NativeHarnessToolDeclaration {
  return {
    name,
    description,
    inputSchema: Schema.toJsonSchemaDocument(schema).schema,
    availability,
  };
}

export const GENERAL_SUBAGENT_NATIVE_HARNESS_DECLARATIONS = [
  declaration(
    "list_agents",
    "List direct T3-managed children owned by this root thread with stable ids, provider selections, statuses, transcript results, and failure details.",
    GeneralSubagentListInput,
    "read-only",
  ),
  declaration(
    "spawn_agent",
    "Start one reusable direct T3-managed child. At most 40 direct children are retained per root and nested spawning is disabled.",
    GeneralSubagentSpawnInput,
    "default-only",
  ),
  declaration(
    "send_message",
    "Queue a message for an owned direct child at its next safe model boundary.",
    GeneralSubagentSendMessageInput,
    "default-only",
  ),
  declaration(
    "followup_task",
    "Queue follow-up work that starts in the same child provider session as soon as it is idle.",
    GeneralSubagentFollowUpInput,
    "default-only",
  ),
  declaration(
    "wait_agent",
    "Wait for one or more owned direct children to reach an idle or terminal boundary.",
    GeneralSubagentWaitInput,
    "read-only",
  ),
  declaration(
    "interrupt_agent",
    "Interrupt one child's active turn while preserving its provider session for follow-up work.",
    GeneralSubagentInterruptInput,
    "default-only",
  ),
] as const;

function successResult(title: string, output: unknown): NativeHarnessToolResult {
  return {
    ok: true,
    itemType: "mcp_tool_call" satisfies CanonicalItemType,
    title,
    detail: title,
    output: output as Readonly<Record<string, unknown>>,
  };
}

function failureResult(name: string, cause: unknown): NativeHarnessToolResult {
  const detail =
    cause instanceof Error ? cause.message : Cause.pretty(cause as Cause.Cause<unknown>);
  return {
    ok: false,
    itemType: "mcp_tool_call",
    title: name,
    detail,
    output: { error: detail },
  };
}

export const makeGeneralSubagentNativeHarnessExtension = Effect.fn(
  "makeGeneralSubagentNativeHarnessExtension",
)(function* (caller: GeneralSubagentCaller) {
  const coordinator = yield* GeneralSubagentCoordinator;

  const execute: NativeHarnessToolExtension["execute"] = (input) => {
    const execution = Effect.gen(function* () {
      switch (input.name) {
        case "list_agents": {
          yield* decodeListInput(input.args);
          return successResult("List direct agents", yield* coordinator.listAgents(caller));
        }
        case "spawn_agent": {
          const args = yield* decodeSpawnInput(input.args);
          return successResult(
            "Spawn direct agent",
            yield* coordinator.spawnAgent({ ...caller, ...args }),
          );
        }
        case "send_message": {
          const args = yield* decodeSendMessageInput(input.args);
          return successResult(
            "Message direct agent",
            yield* coordinator.sendMessage({ ...caller, ...args }),
          );
        }
        case "followup_task": {
          const args = yield* decodeFollowUpInput(input.args);
          return successResult(
            "Follow up with direct agent",
            yield* coordinator.followUp({ ...caller, ...args }),
          );
        }
        case "wait_agent": {
          const args = yield* decodeWaitInput(input.args);
          return successResult(
            "Wait for direct agents",
            yield* coordinator.waitAgent({ ...caller, ...args }),
          );
        }
        case "interrupt_agent": {
          const args = yield* decodeInterruptInput(input.args);
          return successResult(
            "Interrupt direct agent",
            yield* coordinator.interruptAgent({ ...caller, ...args }),
          );
        }
        default:
          return undefined;
      }
    });
    return execution.pipe(
      Effect.catchCause((cause) => Effect.succeed(failureResult(input.name, cause))),
    );
  };

  return {
    declarations: GENERAL_SUBAGENT_NATIVE_HARNESS_DECLARATIONS,
    execute,
  } satisfies NativeHarnessToolExtension;
});
