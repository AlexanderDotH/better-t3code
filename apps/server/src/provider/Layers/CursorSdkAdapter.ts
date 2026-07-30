// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import { ProviderDriverKind, ProviderInstanceId, type ChatAttachment } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { makeHostedAgentAdapter } from "./HostedAgentAdapter.ts";
import {
  forceStopCursorSdkState,
  runCursorSdkTurn,
  stopCursorSdkState,
  type CursorSdkImage,
  type CursorSdkTurnState,
} from "../cursorSdk/CursorSdkClient.ts";
import {
  resolveCursorSdkDefaultModel,
  type CursorSdkSettings,
} from "../cursorSdk/CursorSdkSettings.ts";
import type { CursorSdkAdapterShape } from "../Services/CursorSdkAdapter.ts";

const PROVIDER = ProviderDriverKind.make("cursorSdk");

export interface CursorSdkAdapterOptions {
  readonly instanceId?: ProviderInstanceId | undefined;
}

async function attachmentToCursorImage(
  attachmentsDir: string,
  attachment: ChatAttachment,
): Promise<CursorSdkImage | undefined> {
  const filePath = resolveAttachmentPath({ attachmentsDir, attachment });
  if (!filePath) return undefined;
  const bytes = await NodeFSP.readFile(filePath);
  return {
    data: bytes.toString("base64"),
    mimeType: attachment.mimeType,
  };
}

export function makeCursorSdkAdapter(
  settings: CursorSdkSettings,
  options?: CursorSdkAdapterOptions,
): Effect.Effect<CursorSdkAdapterShape, never, Crypto.Crypto | Scope.Scope | ServerConfig> {
  return Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const instanceId = options?.instanceId ?? ProviderInstanceId.make("cursorSdk");
    const adapter = yield* makeHostedAgentAdapter({
      provider: PROVIDER,
      instanceId,
      sessionModelSwitch: "unsupported",
      startSession: async () =>
        ({
          agent: undefined,
          activeRun: undefined,
          apiKey: undefined,
          cwd: undefined,
          wireModelId: undefined,
        }) satisfies CursorSdkTurnState,
      stopSession: async (_threadId, providerState) => {
        await stopCursorSdkState(providerState as CursorSdkTurnState);
      },
      forceStopSession: async (_threadId, providerState) => {
        return forceStopCursorSdkState(providerState as CursorSdkTurnState);
      },
      runTurn: async (input, providerState) => {
        const state = providerState as CursorSdkTurnState;
        const images = (
          await Promise.all(
            (input.input.attachments ?? []).map((attachment) =>
              attachmentToCursorImage(serverConfig.attachmentsDir, attachment),
            ),
          )
        ).filter((image): image is CursorSdkImage => image !== undefined);
        const result = await runCursorSdkTurn({
          apiKey: settings.apiKey,
          cwd: input.cwd,
          wireModelId: input.model ?? resolveCursorSdkDefaultModel(settings),
          userText: input.input.input ?? "",
          images,
          systemPreamble: input.cwd ? `Workspace: ${input.cwd}` : undefined,
          state,
          signal: input.signal,
          emit: (event) => {
            if (event.kind === "text") input.emit({ kind: "text", text: event.text });
            if (event.kind === "thinking") input.emit({ kind: "thinking", text: event.text });
            if (event.kind === "tool") {
              input.emit({
                kind: "tool",
                name: event.name,
                ...(event.status ? { status: event.status } : {}),
                ...(event.callId ? { callId: event.callId } : {}),
              });
            }
          },
        });
        if (!result.ok) {
          throw new Error(result.error || "Cursor SDK turn failed.");
        }
        return {
          text: result.text,
          ...(result.agentId
            ? {
                resumeCursor: {
                  schemaVersion: 1,
                  agentId: result.agentId,
                },
              }
            : {}),
        };
      },
    });

    return adapter satisfies CursorSdkAdapterShape;
  });
}
