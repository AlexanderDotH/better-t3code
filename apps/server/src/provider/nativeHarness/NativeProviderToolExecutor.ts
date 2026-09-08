import {
  ApprovalRequestId,
  type CanonicalItemType,
  type EventId,
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ProviderInteractionMode,
  RuntimeItemId,
  RuntimeRequestId,
  type TurnId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import type { ProviderAdapterRequestError } from "../Errors.ts";
import { nativeProviderErrorDetail } from "./NativeProviderError.ts";
import type { NativeProviderSessionContext } from "./NativeProviderSessionContext.ts";
import type {
  NativeProviderExecutedToolCall,
  NativeProviderToolCall,
  NativeProviderToolHarness,
  NativeProviderToolResult,
} from "./NativeProviderTypes.ts";

function defaultToolItemType(name: string): CanonicalItemType {
  if (name === "exec_command") return "command_execution";
  if (name === "workspace_edit") {
    return "file_change";
  }
  return "mcp_tool_call";
}

function defaultToolEventData(call: NativeProviderToolCall): Readonly<Record<string, unknown>> {
  if (call.name === "workspace_edit" && Array.isArray(call.args.changes)) {
    const paths = call.args.changes.flatMap((change) =>
      typeof change === "object" &&
      change !== null &&
      "path" in change &&
      typeof change.path === "string"
        ? [change.path]
        : [],
    );
    return { paths, changeCount: call.args.changes.length };
  }
  return call.args;
}

function encodedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const MODEL_TOOL_RESULT_MAX_BYTES = 32 * 1024;
const MODEL_TOOL_RESULT_DIGEST_MAX_BYTES = 16 * 1024;

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const item of Object.values(value)) collectStrings(item, output);
}

function findExitCode(value: unknown): number | null | undefined {
  if (value === null || typeof value !== "object") return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (
      (key === "exitCode" || key === "exit_code") &&
      (typeof item === "number" || item === null)
    ) {
      return item;
    }
    const nested = findExitCode(item);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function changedPaths(result: NativeProviderToolResult): ReadonlyArray<string> {
  const paths: string[] = [];
  const pathFields = new Set([
    "path",
    "paths",
    "filePath",
    "relativePath",
    "changedPaths",
    "changed_paths",
    "files",
  ]);
  const visit = (value: unknown, field?: string): void => {
    if (typeof value === "string") {
      if (field && pathFields.has(field) && value.trim()) paths.push(value.trim().slice(0, 256));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, field);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      visit(item, key);
    }
  };
  visit(result.output);
  return Array.from(new Set(paths)).slice(0, 12);
}

export function modelFacingNativeProviderToolResult(
  result: NativeProviderToolResult,
  input: {
    readonly itemId: RuntimeItemId;
    readonly status: "completed" | "failed" | "declined";
  },
): NativeProviderToolResult {
  const byteCount = encodedBytes(result.output);
  if (byteCount <= MODEL_TOOL_RESULT_MAX_BYTES) return result;
  const strings: string[] = [];
  collectStrings(result.output, strings);
  const errorLines = [result.detail, ...strings]
    .flatMap((value) => value.split(/\r?\n/u))
    .map((line) => line.trim())
    .filter((line) =>
      /\b(error|failed|failure|exception|fatal|denied|invalid|not found)\b/iu.test(line),
    )
    .filter((line, index, lines) => line.length > 0 && lines.indexOf(line) === index)
    .slice(0, 12)
    .map((line) => line.slice(0, 256));
  const paths = changedPaths(result);
  const exitCode = findExitCode(result.output);
  const title = result.title.slice(0, 256);
  const detail = result.detail.slice(0, 1_024);
  const output = {
    ok: result.ok,
    status: input.status,
    title,
    detail,
    byteCount,
    lineCount: strings.reduce((count, value) => count + value.split(/\r?\n/u).length, 0),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(paths.length > 0 ? { changedPaths: paths } : {}),
    ...(errorLines.length > 0 ? { errorLines } : {}),
    detailRef: `tool-result:${input.itemId}`,
  };
  if (encodedBytes(output) > MODEL_TOOL_RESULT_DIGEST_MAX_BYTES) {
    return {
      ...result,
      title,
      detail,
      output: {
        ok: result.ok,
        status: input.status,
        title,
        detail,
        byteCount,
        lineCount: strings.reduce((count, value) => count + value.split(/\r?\n/u).length, 0),
        ...(exitCode !== undefined ? { exitCode } : {}),
        detailRef: `tool-result:${input.itemId}`,
      },
    };
  }
  return {
    ...result,
    title,
    detail,
    output,
  };
}

export function makeNativeProviderToolExecutor<
  HistoryItem,
  SessionState,
  ToolCall extends NativeProviderToolCall,
>(input: {
  readonly provider: ProviderDriverKind;
  readonly environment: NodeJS.ProcessEnv;
  readonly toolHarness: NativeProviderToolHarness<ToolCall>;
  readonly maxToolOutputBytes: number;
  readonly randomUuid: Effect.Effect<string, ProviderAdapterRequestError>;
  readonly makeEventStamp: () => Effect.Effect<
    { readonly eventId: EventId; readonly createdAt: string },
    ProviderAdapterRequestError
  >;
}) {
  return Effect.fn("NativeProviderToolExecutor.executeTool")(function* (request: {
    readonly context: NativeProviderSessionContext<HistoryItem, SessionState>;
    readonly turnId: TurnId;
    readonly call: ToolCall;
    readonly interactionMode: ProviderInteractionMode | undefined;
    readonly interrupt: Deferred.Deferred<void>;
  }) {
    const { context, turnId, call, interactionMode, interrupt } = request;
    const itemId = RuntimeItemId.make(call.sourceId?.trim() || (yield* input.randomUuid));
    const detail = input.toolHarness.approvalDetail(call.name, call.args);
    yield* context.emitRuntimeEvent({
      type: "item.started",
      ...(yield* input.makeEventStamp()),
      provider: input.provider,
      threadId: context.threadId,
      turnId,
      itemId,
      payload: {
        itemType: defaultToolItemType(call.name),
        status: "inProgress",
        title: call.name,
        detail,
        data: input.toolHarness.eventData?.(call) ?? defaultToolEventData(call),
      },
    });
    const available = yield* input.toolHarness.isAvailable({
      threadId: context.threadId,
      cwd: context.cwd,
      toolName: call.name,
      interactionMode,
      sandboxMode: context.fetchWorker ? "read-only" : context.sandboxMode,
      fetchWorker: context.fetchWorker,
    });
    let decision: ProviderApprovalDecision = "accept";
    const requiresApproval =
      available &&
      !context.approvedForSession.has(call.name) &&
      input.toolHarness.requiresApproval(call.name, context.session.runtimeMode);
    if (requiresApproval) {
      const rawRequestId = yield* input.randomUuid;
      const requestId = ApprovalRequestId.make(rawRequestId);
      const runtimeRequestId = RuntimeRequestId.make(rawRequestId);
      const pending = {
        decision: yield* Deferred.make<ProviderApprovalDecision>(),
        toolName: call.name,
      };
      context.pendingApprovals.set(requestId, pending);
      const requestType = input.toolHarness.requestType(call.name);
      yield* context.emitRuntimeEvent({
        type: "request.opened",
        ...(yield* input.makeEventStamp()),
        provider: input.provider,
        threadId: context.threadId,
        turnId,
        itemId,
        requestId: runtimeRequestId,
        payload: { requestType, detail, args: call.args },
      });
      decision = yield* Effect.raceFirst(
        Deferred.await(pending.decision),
        Deferred.await(interrupt).pipe(Effect.andThen(Effect.interrupt)),
      ).pipe(Effect.ensuring(Effect.sync(() => context.pendingApprovals.delete(requestId))));
      yield* context.emitRuntimeEvent({
        type: "request.resolved",
        ...(yield* input.makeEventStamp()),
        provider: input.provider,
        threadId: context.threadId,
        turnId,
        itemId,
        requestId: runtimeRequestId,
        payload: { requestType, decision },
      });
      if (decision === "acceptForSession") context.approvedForSession.add(call.name);
    }
    const declined = decision === "decline" || decision === "cancel";
    const result: NativeProviderToolResult = !available
      ? {
          ok: false,
          itemType: defaultToolItemType(call.name),
          title: call.name,
          detail: `T3 did not expose '${call.name}' for this session mode.`,
          output: { error: `Tool '${call.name}' is not available in this session mode.` },
        }
      : declined
        ? {
            ok: false,
            itemType: "dynamic_tool_call",
            title: call.name,
            detail: decision === "cancel" ? "Tool call cancelled." : "Tool call declined.",
            output: { error: `Tool call ${decision}.` },
          }
        : yield* input.toolHarness
            .execute({
              threadId: context.threadId,
              name: call.name,
              args: call.args,
              cwd: context.cwd,
              environment: input.environment,
              fetchWorker: context.fetchWorker,
            })
            .pipe(
              Effect.catch((cause) => {
                const detail = nativeProviderErrorDetail(cause);
                return Effect.succeed({
                  ok: false,
                  itemType: defaultToolItemType(call.name),
                  title: call.name,
                  detail,
                  output: { error: detail },
                });
              }),
            );
    const status = declined ? "declined" : result.ok ? "completed" : "failed";
    yield* context.emitRuntimeEvent({
      type: "item.completed",
      ...(yield* input.makeEventStamp()),
      provider: input.provider,
      threadId: context.threadId,
      turnId,
      itemId,
      payload: {
        itemType: result.itemType,
        status,
        title: result.title,
        detail: result.detail,
        data: result.output,
      },
    });
    if (
      result.itemType === "command_execution" &&
      encodedBytes(result.output) <= MODEL_TOOL_RESULT_MAX_BYTES
    ) {
      const output =
        typeof result.output.output === "string"
          ? result.output.output
          : typeof result.output.stdout === "string"
            ? result.output.stdout
            : "";
      if (output) {
        // Oversized terminal results stay live through item.completed. Emitting
        // this synthesized stream too would persist a second full copy.
        yield* context.emitRuntimeEvent({
          type: "content.delta",
          ...(yield* input.makeEventStamp()),
          provider: input.provider,
          threadId: context.threadId,
          turnId,
          itemId,
          payload: { streamKind: "command_output", delta: output },
        });
      }
    }
    return {
      call,
      result: modelFacingNativeProviderToolResult(result, { itemId, status }),
    } satisfies NativeProviderExecutedToolCall<ToolCall>;
  });
}
