import { describe, expect, it } from "@effect/vitest";
import { type OpenAiCompatibleSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import {
  OpenAiCompatibleAuthenticationError,
  OpenAiCompatibleHttpError,
  type OpenAiCompatibleTransport,
} from "../provider/openaiCompatible/OpenAiCompatibleTransport.ts";
import type {
  OpenAiCompatibleRoundEvent,
  OpenAiCompatibleRoundRequest,
} from "../provider/openaiCompatible/OpenAiCompatibleProtocol.ts";
import { makeOpenAiCompatibleTextGeneration } from "./OpenAiCompatibleTextGeneration.ts";

const INSTANCE = ProviderInstanceId.make("compatible-text-test");
const SETTINGS = {
  enabled: true,
  baseUrl: "http://localhost:1234/v1",
  defaultModel: "configured-coder",
  customModels: [],
} satisfies OpenAiCompatibleSettings;
const INPUT = {
  cwd: "/workspace",
  message: "Improve the app",
  attachments: [],
  modelSelection: { instanceId: INSTANCE, model: "selected-coder" },
};

function completion(text: string): OpenAiCompatibleRoundEvent {
  return {
    type: "completed",
    model: "selected-coder",
    assistantText: text,
    toolCalls: [],
    historyItems: [{ type: "assistant", content: text }],
  };
}

function makeTransport(
  output: Array<string>,
  requests: Array<OpenAiCompatibleRoundRequest> = [],
): OpenAiCompatibleTransport {
  return {
    baseUrl: SETTINGS.baseUrl,
    listModels: Effect.fail(
      new OpenAiCompatibleHttpError({
        operation: "models",
        category: "catalog-not-found",
        status: 404,
        message: "The endpoint does not expose a model catalog.",
      }),
    ),
    streamRound: (request) => {
      requests.push(request);
      return Stream.succeed(completion(output.shift() ?? ""));
    },
  };
}

describe("OpenAiCompatibleTextGeneration", () => {
  for (const driverKind of ["openaiCompatible", "lmstudio"] as const) {
    it.effect(
      `${driverKind} uses selected manual models and configured defaults without model discovery`,
      () =>
        Effect.gen(function* () {
          const requests: Array<OpenAiCompatibleRoundRequest> = [];
          const service = makeOpenAiCompatibleTextGeneration(SETTINGS, {
            driverKind,
            instanceId: INSTANCE,
            transport: makeTransport(
              [
                '{"title":"  First title  "}',
                '{"title":"Second title"}',
                '{"title":"Own default"}',
              ],
              requests,
            ),
          });
          expect(yield* service.generateThreadTitle(INPUT)).toEqual({ title: "First title" });
          expect(
            yield* service.generateThreadTitle({
              ...INPUT,
              modelSelection: { instanceId: INSTANCE, model: "" },
            }),
          ).toEqual({ title: "Second title" });
          expect(
            yield* service.generateThreadTitle({
              ...INPUT,
              modelSelection: {
                instanceId: ProviderInstanceId.make("other-instance"),
                model: "other-instance-model",
              },
            }),
          ).toEqual({ title: "Own default" });
          expect(requests.map((request) => request.model)).toEqual([
            "selected-coder",
            "configured-coder",
            "configured-coder",
          ]);
          expect(requests[0]?.instructions).toContain("exactly one JSON object");
          expect(requests[0]?.tools).toEqual([]);
          expect(requests[0]).not.toHaveProperty("responseFormat");
        }),
    );
  }

  it.effect(
    "accepts a selected model without a default and blocks disabled or missing models",
    () =>
      Effect.gen(function* () {
        const requests: Array<OpenAiCompatibleRoundRequest> = [];
        const options = {
          driverKind: "openaiCompatible" as const,
          instanceId: INSTANCE,
          transport: makeTransport(['{"title":"Manual"}'], requests),
        };
        const manual = makeOpenAiCompatibleTextGeneration(
          { ...SETTINGS, defaultModel: "" },
          options,
        );
        expect(yield* manual.generateThreadTitle(INPUT)).toEqual({ title: "Manual" });
        const missing = yield* manual
          .generateThreadTitle({ ...INPUT, modelSelection: { instanceId: INSTANCE, model: "" } })
          .pipe(Effect.flip);
        expect(missing.detail).toContain("Select a model");
        const disabled = makeOpenAiCompatibleTextGeneration(
          { ...SETTINGS, enabled: false },
          options,
        );
        expect((yield* disabled.generateThreadTitle(INPUT).pipe(Effect.flip)).detail).toContain(
          "disabled",
        );
        expect(requests).toHaveLength(1);
      }),
  );

  it.effect("preserves commit, branch, and metadata validation and sanitization", () =>
    Effect.gen(function* () {
      const service = makeOpenAiCompatibleTextGeneration(SETTINGS, {
        driverKind: "lmstudio",
        instanceId: INSTANCE,
        transport: makeTransport([
          '{"subject":"  Fix endpoint selection  ","body":"  Persist selected model.  ","branch":"feature/endpoint-selection"}',
          '{"title":"  Endpoint support  ","branch":"Endpoint Support"}',
          '{"text":"  Improve the endpoint model selection.  "}',
        ]),
      });
      expect(
        yield* service.generateCommitMessage({
          cwd: "/workspace",
          branch: null,
          stagedSummary: "Endpoint changes",
          stagedPatch: "+changes",
          includeBranch: true,
          modelSelection: INPUT.modelSelection,
        }),
      ).toEqual({
        subject: "Fix endpoint selection",
        body: "Persist selected model.",
        branch: "feature/endpoint-selection",
      });
      expect(yield* service.generateThreadMetadata(INPUT)).toEqual({
        title: "Endpoint support",
        branch: "endpoint-support",
      });
      expect(
        yield* service.improvePrompt({
          cwd: "/workspace",
          text: "Improve selection",
          modelSelection: INPUT.modelSelection,
        }),
      ).toEqual({ text: "Improve the endpoint model selection." });
    }),
  );

  it.effect("rejects malformed structured output without retaining model output", () =>
    Effect.gen(function* () {
      const service = makeOpenAiCompatibleTextGeneration(SETTINGS, {
        driverKind: "openaiCompatible",
        instanceId: INSTANCE,
        transport: makeTransport([
          '{"title":22,"secret":"private-output"}',
          "not-json-private-output",
        ]),
      });
      for (let index = 0; index < 2; index++) {
        const error = yield* service.generateThreadTitle(INPUT).pipe(Effect.flip);
        expect(error.detail).toBe("OpenAI Compatible returned invalid structured output.");
        expect(error).not.toHaveProperty("cause");
      }
    }),
  );

  it.effect("preserves sanitized authentication and network failures", () =>
    Effect.gen(function* () {
      for (const failure of [
        new OpenAiCompatibleAuthenticationError({
          status: 401,
          message: "The endpoint rejected the API key.",
        }),
        new OpenAiCompatibleHttpError({
          operation: "chat-completions",
          category: "network",
          message: "The endpoint could not be reached.",
        }),
      ]) {
        const service = makeOpenAiCompatibleTextGeneration(SETTINGS, {
          driverKind: "lmstudio",
          instanceId: INSTANCE,
          transport: { ...makeTransport([]), streamRound: () => Stream.fail(failure) },
        });
        const error = yield* service.generateThreadTitle(INPUT).pipe(Effect.flip);
        expect(error.detail).toBe(`LM Studio text generation request failed: ${failure.message}`);
        expect(error).not.toHaveProperty("cause");
      }
    }),
  );

  it.effect("interrupts the completion stream when background generation is cancelled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const blocked = yield* Deferred.make<OpenAiCompatibleRoundEvent>();
        let released = false;
        const service = makeOpenAiCompatibleTextGeneration(SETTINGS, {
          driverKind: "openaiCompatible",
          instanceId: INSTANCE,
          transport: {
            ...makeTransport([]),
            streamRound: () =>
              Stream.fromEffect(
                Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(blocked))),
              ).pipe(
                Stream.ensuring(
                  Effect.sync(() => {
                    released = true;
                  }),
                ),
              ),
          },
        });
        const fiber = yield* service.generateThreadTitle(INPUT).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        expect(released).toBe(true);
      }),
    ),
  );
});
