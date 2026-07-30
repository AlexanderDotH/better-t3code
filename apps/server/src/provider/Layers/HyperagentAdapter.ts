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
  runHyperagentTurn,
  sanitizeHyperagentAttachment,
  type FetchLike,
} from "../hyperagent/HyperagentClient.ts";
import {
  resolveHyperagentBaseUrl,
  resolveHyperagentDefaultModel,
  resolveHyperagentFastMode,
  resolveHyperagentSessionCookie,
  type HyperagentSettings,
} from "../hyperagent/HyperagentSettings.ts";
import type { HyperagentAdapterShape } from "../Services/HyperagentAdapter.ts";

const PROVIDER = ProviderDriverKind.make("hyperagent");

export interface HyperagentAdapterOptions {
  readonly instanceId?: ProviderInstanceId | undefined;
  readonly fetchImpl?: FetchLike | undefined;
}

async function attachmentToInline(
  attachmentsDir: string,
  attachment: ChatAttachment,
): Promise<ReturnType<typeof sanitizeHyperagentAttachment>> {
  const filePath = resolveAttachmentPath({ attachmentsDir, attachment });
  if (!filePath) return undefined;
  const bytes = await NodeFSP.readFile(filePath);
  return sanitizeHyperagentAttachment(attachment, bytes.toString("base64"));
}

export function makeHyperagentAdapter(
  settings: HyperagentSettings,
  options?: HyperagentAdapterOptions,
): Effect.Effect<HyperagentAdapterShape, never, Crypto.Crypto | Scope.Scope | ServerConfig> {
  return Effect.gen(function* () {
    const serverConfig = yield* ServerConfig;
    const instanceId = options?.instanceId ?? ProviderInstanceId.make("hyperagent");

    const adapter = yield* makeHostedAgentAdapter({
      provider: PROVIDER,
      instanceId,
      sessionModelSwitch: "unsupported",
      runTurn: async (input) => {
        const inlineAttachments = (
          await Promise.all(
            (input.input.attachments ?? []).map((attachment) =>
              attachmentToInline(serverConfig.attachmentsDir, attachment),
            ),
          )
        ).filter(
          (attachment): attachment is NonNullable<typeof attachment> => attachment !== undefined,
        );

        const result = await runHyperagentTurn({
          sessionCookie: resolveHyperagentSessionCookie(settings),
          baseUrl: resolveHyperagentBaseUrl(settings),
          modelId: input.model ?? resolveHyperagentDefaultModel(settings),
          content: input.input.input ?? "",
          systemPrompt: input.cwd ? `Workspace: ${input.cwd}` : undefined,
          fastMode: resolveHyperagentFastMode(settings),
          attachments: inlineAttachments,
          signal: input.signal,
          fetchImpl: options?.fetchImpl,
          emit: (event) => {
            if (event.kind === "text") input.emit({ kind: "text", text: event.text });
            if (event.kind === "thinking") input.emit({ kind: "thinking", text: event.text });
            if (event.kind === "status") input.emit({ kind: "status", text: event.text });
          },
        });

        return {
          text: result.text,
          thinking: result.thinking,
          usage: result.usage,
          costUsd: result.costUsd,
          resumeCursor: {
            schemaVersion: 1,
            threadId: result.threadId,
          },
        };
      },
    });

    return adapter satisfies HyperagentAdapterShape;
  });
}
