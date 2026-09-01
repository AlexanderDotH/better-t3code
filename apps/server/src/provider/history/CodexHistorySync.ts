import type { CodexSettings } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as CodexClient from "effect-codex-app-server/client";
import type * as CodexErrors from "effect-codex-app-server/errors";
import type * as CodexRpc from "effect-codex-app-server/rpc";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { expandHomePath } from "../../pathExpansion.ts";
import { buildCodexInitializeParams } from "../Layers/CodexProvider.ts";
import { codexSessionAppServerArgs } from "../Layers/codexLaunchArgs.ts";
import { resolveCodexLaunchArgs } from "../Layers/codexLaunchArgs.ts";
import { codexManagedFeatureArgs } from "../CodexProcessArgs.ts";
import {
  ProviderHistorySyncError,
  type ProviderHistoryAttachment,
  type ProviderHistoryListResult,
  type ProviderHistorySyncAdapter,
  type ProviderHistoryTranscript,
  type ProviderHistoryTranscriptItem,
} from "../Services/ProviderHistorySync.ts";
import {
  normalizeVisibleProviderHistoryTranscript,
  type ProviderHistoryTranscriptCandidate,
} from "./visibleTranscript.ts";

const CODEX_HISTORY_FORCE_KILL_AFTER = "2 seconds" as const;

const CodexHistoryCursor = Schema.Struct({
  phase: Schema.Literals(["current", "archived"]),
  cursor: Schema.optionalKey(Schema.String),
});
type CodexHistoryCursor = typeof CodexHistoryCursor.Type;
const decodeCodexHistoryCursor = Schema.decodeUnknownOption(CodexHistoryCursor);

export interface CodexHistoryDataSource<E> {
  readonly listThreads: (
    input: CodexRpc.ClientRequestParamsByMethod["thread/list"],
  ) => Effect.Effect<CodexRpc.ClientRequestResponsesByMethod["thread/list"], E>;
  readonly readThread: (
    input: CodexRpc.ClientRequestParamsByMethod["thread/read"],
  ) => Effect.Effect<CodexRpc.ClientRequestResponsesByMethod["thread/read"], E>;
}

function errorDetail(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return String(cause);
}

function historyError(input: {
  readonly sourceId: string;
  readonly operation: string;
  readonly sessionId?: string;
  readonly cause: unknown;
}): ProviderHistorySyncError {
  return new ProviderHistorySyncError({
    sourceId: input.sourceId,
    operation: input.operation,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    detail: errorDetail(input.cause),
    cause: input.cause,
  });
}

function secondsToIso(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
  return DateTime.formatIso(DateTime.makeUnsafe(value * 1_000));
}

function threadActivity(
  status: CodexSchema.V2ThreadReadResponse__ThreadStatus,
): "active" | "idle" | "unknown" {
  if (status.type === "active") return "active";
  if (status.type === "idle") return "idle";
  return "unknown";
}

function isTopLevelDurableThread(thread: CodexSchema.V2ThreadListResponse__Thread): boolean {
  if (thread.ephemeral || thread.parentThreadId != null) return false;
  return !(typeof thread.source === "object" && "subAgent" in thread.source);
}

function listedThreadSummary(thread: CodexSchema.V2ThreadListResponse__Thread, archived: boolean) {
  const name = thread.name?.trim();
  const preview = thread.preview.trim();
  return {
    sessionId: thread.id,
    title: name || preview || null,
    preview: preview || null,
    cwd: thread.cwd.trim() || null,
    model: null,
    ...(secondsToIso(thread.createdAt) ? { createdAt: secondsToIso(thread.createdAt) } : {}),
    updatedAt: secondsToIso(thread.updatedAt)!,
    archived,
    isChild: false,
    activity: threadActivity(thread.status),
  } as const;
}

function encodeCursor(cursor: CodexHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): CodexHistoryCursor {
  if (!value) return { phase: "current" };
  try {
    return Option.getOrElse(
      decodeCodexHistoryCursor(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))),
      () => ({ phase: "current" as const }),
    );
  } catch {
    return { phase: "current" };
  }
}

function attachmentName(input: string, fallback: string): string {
  try {
    const parsed = new URL(input);
    return pathBasename(parsed.pathname) || fallback;
  } catch {
    return pathBasename(input) || fallback;
  }
}

function pathBasename(value: string): string {
  return value.split(/[\\/]/u).at(-1) ?? "";
}

function pathExtension(value: string): string {
  const name = pathBasename(value.split(/[?#]/u, 1)[0] ?? "");
  const extensionIndex = name.lastIndexOf(".");
  return extensionIndex < 0 ? "" : name.slice(extensionIndex).toLowerCase();
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".webp": "image/webp",
};

function inferMimeType(value: string, type: "image" | "audio"): string {
  const dataUrlMatch = /^data:([^;,]+)/u.exec(value);
  if (dataUrlMatch?.[1]) return dataUrlMatch[1];
  const extension = pathExtension(value);
  return MIME_BY_EXTENSION[extension] ?? `${type}/*`;
}

function codexAttachment(
  itemId: string,
  input: CodexSchema.V2ThreadReadResponse__UserInput,
  index: number,
): ProviderHistoryAttachment | undefined {
  const nativeAttachmentId = `${itemId}:attachment:${index}`;
  const ordinal = index + 1;
  switch (input.type) {
    case "image":
    case "audio": {
      const type = input.type;
      const mimeType = inferMimeType(input.url, type);
      return {
        type,
        nativeAttachmentId,
        name: attachmentName(input.url, `${type}-${ordinal}`),
        mimeType,
        content: input.url.startsWith("data:")
          ? { type: "data-url", dataUrl: input.url }
          : { type: "url", url: input.url },
      };
    }
    case "localImage":
    case "localAudio": {
      const type = input.type === "localImage" ? "image" : "audio";
      return {
        type,
        nativeAttachmentId,
        name: attachmentName(input.path, `${type}-${ordinal}`),
        mimeType: inferMimeType(input.path, type),
        content: { type: "file", path: input.path },
      };
    }
    default:
      return undefined;
  }
}

function turnItems(
  turn: CodexSchema.V2ThreadReadResponse__Turn,
): ReadonlyArray<ProviderHistoryTranscriptItem> {
  const createdAt = secondsToIso(turn.startedAt);
  const updatedAt = secondsToIso(turn.completedAt);
  const candidates: ProviderHistoryTranscriptCandidate[] = [];
  for (const item of turn.items) {
    if (item.type === "userMessage") {
      const text = item.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n");
      const attachments = item.content.flatMap((content, index) => {
        const attachment = codexAttachment(item.id, content, index);
        return attachment ? [attachment] : [];
      });
      candidates.push({
        kind: "message",
        nativeMessageId: item.id,
        role: "user",
        text,
        attachments,
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      });
      continue;
    }
    if (item.type === "agentMessage") {
      candidates.push({
        kind: "message",
        nativeMessageId: item.id,
        role: "assistant",
        text: item.text,
        attachments: [],
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      });
      continue;
    }
    if (item.type === "plan") {
      candidates.push({
        kind: "plan",
        nativePlanId: item.id,
        markdown: item.text,
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      });
    }
  }
  return normalizeVisibleProviderHistoryTranscript(candidates);
}

function transcriptFromThread(
  thread: CodexSchema.V2ThreadReadResponse__Thread,
): ProviderHistoryTranscript {
  return {
    sessionId: thread.id,
    items: normalizeVisibleProviderHistoryTranscript(thread.turns.flatMap(turnItems)),
    ...(thread.cwd.trim().length > 0 ? { cwd: thread.cwd } : {}),
    updatedAt: secondsToIso(thread.updatedAt)!,
  };
}

export function makeCodexHistorySyncAdapter<E>(
  input: { readonly sourceId: string } & CodexHistoryDataSource<E>,
): ProviderHistorySyncAdapter {
  const list: ProviderHistorySyncAdapter["list"] = (request) =>
    Effect.gen(function* () {
      const items: ProviderHistoryListResult["items"][number][] = [];
      const visited = new Set<string>();
      let state = decodeCursor(request.cursor);
      let exhausted = false;

      while (items.length < request.limit && !exhausted) {
        const visitKey = `${state.phase}:${state.cursor ?? ""}`;
        if (visited.has(visitKey)) break;
        visited.add(visitKey);
        const archived = state.phase === "archived";
        const page = yield* input
          .listThreads({
            archived,
            ...(request.query?.trim() ? { searchTerm: request.query.trim() } : {}),
            ...(request.cwd?.trim() ? { cwd: request.cwd.trim() } : {}),
            ...(state.cursor ? { cursor: state.cursor } : {}),
            limit: Math.max(1, request.limit - items.length),
            sortDirection: "desc",
            sortKey: "updated_at",
          })
          .pipe(
            Effect.mapError((cause) =>
              historyError({ sourceId: input.sourceId, operation: "list", cause }),
            ),
          );
        const visible = page.data
          .filter(isTopLevelDurableThread)
          .map((thread) => listedThreadSummary(thread, archived));
        items.push(...visible.slice(0, request.limit - items.length));

        if (page.nextCursor) {
          state = { phase: state.phase, cursor: page.nextCursor };
          continue;
        }
        if (state.phase === "current" && request.includeArchived) {
          state = { phase: "archived" };
          continue;
        }
        exhausted = true;
      }

      const latestUpdatedAt = items.reduce<string | undefined>(
        (latest, item) => (!latest || item.updatedAt > latest ? item.updatedAt : latest),
        undefined,
      );
      return {
        items,
        ...(exhausted ? {} : { nextCursor: encodeCursor(state) }),
        ...(latestUpdatedAt ? { latestUpdatedAt } : {}),
      };
    });

  const read: ProviderHistorySyncAdapter["read"] = ({ sessionId }) =>
    input.readThread({ threadId: sessionId, includeTurns: true }).pipe(
      Effect.map((response) => transcriptFromThread(response.thread)),
      Effect.mapError((cause) =>
        historyError({ sourceId: input.sourceId, operation: "read", sessionId, cause }),
      ),
    );

  const checkActivity: NonNullable<ProviderHistorySyncAdapter["checkActivity"]> = ({ sessionId }) =>
    input.readThread({ threadId: sessionId, includeTurns: false }).pipe(
      Effect.map((response) => threadActivity(response.thread.status)),
      Effect.mapError((cause) =>
        historyError({ sourceId: input.sourceId, operation: "status", sessionId, cause }),
      ),
    );

  return {
    list,
    read,
    resumeCursor: ({ sessionId }) => Effect.succeed({ resumeCursor: { threadId: sessionId } }),
    checkActivity,
  };
}

export const makeLiveCodexHistorySyncAdapter = Effect.fn("makeLiveCodexHistorySyncAdapter")(
  function* (input: {
    readonly sourceId: string;
    readonly config: Pick<CodexSettings, "binaryPath" | "homePath" | "launchArgs">;
    readonly environment: NodeJS.ProcessEnv;
    readonly cwd: string;
  }): Effect.fn.Return<ProviderHistorySyncAdapter, never, ChildProcessSpawner.ChildProcessSpawner> {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    type LiveHistoryError = CodexErrors.CodexAppServerError | PlatformError.PlatformError;
    const withClient = <A>(
      use: (
        client: CodexClient.CodexAppServerClient["Service"],
      ) => Effect.Effect<A, CodexErrors.CodexAppServerError>,
    ): Effect.Effect<A, LiveHistoryError> =>
      Effect.scoped(
        Effect.gen(function* () {
          const resolvedHomePath = input.config.homePath.trim()
            ? expandHomePath(input.config.homePath)
            : undefined;
          const environment = {
            ...input.environment,
            ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
          };
          const appServerArgs = codexSessionAppServerArgs(
            codexManagedFeatureArgs(),
            resolveCodexLaunchArgs(input.config.launchArgs, environment),
          );
          const spawnCommand = yield* resolveSpawnCommand(input.config.binaryPath, appServerArgs, {
            env: environment,
            extendEnv: false,
          });
          const child = yield* spawner.spawn(
            ChildProcess.make(spawnCommand.command, spawnCommand.args, {
              cwd: input.cwd,
              env: environment,
              extendEnv: false,
              forceKillAfter: CODEX_HISTORY_FORCE_KILL_AFTER,
              shell: spawnCommand.shell,
            }),
          );
          const clientContext = yield* CodexClient.layerChildProcess(child).pipe(Layer.build);
          const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
            Effect.provide(clientContext),
          );
          yield* client.request("initialize", buildCodexInitializeParams());
          yield* client.notify("initialized", undefined);
          return yield* use(client);
        }),
      );

    return makeCodexHistorySyncAdapter({
      sourceId: input.sourceId,
      listThreads: (request) => withClient((client) => client.request("thread/list", request)),
      readThread: (request) => withClient((client) => client.request("thread/read", request)),
    });
  },
);
