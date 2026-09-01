import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProcessRunner } from "../../processRunner.ts";
import { makeNativeProviderHarness } from "../nativeHarness/NativeProviderHarness.ts";
import {
  NativeHarnessToolPolicyError,
  type NativeHarnessToolExtension,
} from "../nativeHarness/NativeHarnessTools.ts";
import { ChatGptAdapterBoundaryError, type ChatGptHarness } from "./ChatGptAdapter.ts";

/** ChatGPT-owned error translation around the shared native tool strategy. */
export const makeChatGptNativeHarness = Effect.fn("makeChatGptNativeHarness")(function* (
  processRunner: ProcessRunner["Service"],
  options?: {
    readonly extensionForThread?:
      | ((input: {
          readonly threadId: ThreadId;
          readonly cwd: string;
        }) => Effect.Effect<NativeHarnessToolExtension, NativeHarnessToolPolicyError>)
      | undefined;
    readonly releaseThread?: ((threadId: ThreadId) => Effect.Effect<void>) | undefined;
  },
) {
  const harness = yield* makeNativeProviderHarness(processRunner, options);
  const mapBoundaryError = (operation: string) => (cause: NativeHarnessToolPolicyError) =>
    new ChatGptAdapterBoundaryError({ operation, detail: cause.detail, cause });

  return {
    declarations: (input) =>
      harness.declarations(input).pipe(Effect.mapError(mapBoundaryError("tools/catalog"))),
    isAvailable: (input) =>
      harness.isAvailable(input).pipe(Effect.mapError(mapBoundaryError("tools/availability"))),
    requiresApproval: harness.requiresApproval,
    requestType: harness.requestType,
    approvalDetail: harness.approvalDetail,
    execute: (input) =>
      harness.execute(input).pipe(Effect.mapError(mapBoundaryError("tools/execute"))),
    ...(harness.releaseThread ? { releaseThread: harness.releaseThread } : {}),
  } satisfies ChatGptHarness;
});
