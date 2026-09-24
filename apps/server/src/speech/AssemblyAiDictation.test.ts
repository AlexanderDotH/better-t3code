import { describe, expect, it, vi } from "@effect/vitest";
import {
  DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
  type AssemblyAiVoiceSettings,
  type OrchestrationProjectShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type SpeechVocabularyEntry,
  makeBetterT3SettingsV1,
} from "@t3tools/contracts";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Dictation from "./AssemblyAiDictation.ts";
import { ProjectSpeechVocabulary } from "./ProjectSpeechVocabulary.ts";

const projectId = ProjectId.make("speech-project");
const threadId = ThreadId.make("speech-thread");
const project: OrchestrationProjectShell = {
  id: projectId,
  title: "Voice tests",
  workspaceRoot: "/trusted/project",
  defaultModelSelection: null,
  checkpointsEnabled: true,
  scripts: [],
  createdAt: "2026-09-18T10:00:00.000Z",
  updatedAt: "2026-09-18T10:00:00.000Z",
};
const entries: readonly SpeechVocabularyEntry[] = [
  { kind: "file", name: "index.ts", path: "apps/web/index.ts" },
  { kind: "function", name: "mountApp", path: "apps/web/index.ts", line: 12 },
  { kind: "file", name: "index.ts", path: "apps/server/index.ts" },
  { kind: "function", name: "startServer", path: "apps/server/index.ts", line: 42 },
];
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeRequest = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      model: Schema.String,
      messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.String })),
      response_format: Schema.Struct({ type: Schema.String }),
    }),
  ),
);

function requestBody(request: HttpClientRequest.HttpClientRequest) {
  if (request.body._tag !== "Uint8Array") throw new Error("Expected a JSON request body.");
  return decodeRequest(new TextDecoder().decode(request.body.body));
}

function gatewayResponse(text: string, files: readonly { mention: string; file: string }[] = []) {
  return Response.json({
    choices: [{ message: { content: encodeJson({ text, files }) }, finish_reason: "stop" }],
  });
}

function notFound(path: string) {
  return PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method: "stat",
    pathOrDescriptor: path,
  });
}

const fileInfo: FileSystem.File.Info = {
  type: "File",
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 1,
  ino: Option.none(),
  mode: 0o644,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(10),
  blksize: Option.none(),
  blocks: Option.none(),
};

function makeLayer(input: {
  readonly options?: Partial<AssemblyAiVoiceSettings>;
  readonly entries?: readonly SpeechVocabularyEntry[];
  readonly projectFound?: boolean;
  readonly threadProjectId?: ProjectId;
  readonly worktreePath?: string;
  readonly enabled?: boolean;
  readonly apiKey?: string;
  readonly realPath?: (path: string) => string;
  readonly missingPaths?: readonly string[];
  readonly respond?: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly neverComplete?: boolean;
  readonly generatedText?: string;
}) {
  const snapshot = vi.fn((_input: { workspaceRoot: string }) =>
    Effect.succeed({ entries: input.entries ?? entries, version: 1, truncated: false }),
  );
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) => {
    if (input.neverComplete && request.url.endsWith("/chat/completions")) return Effect.never;
    const response =
      input.respond?.(request) ??
      (request.url.endsWith("/models")
        ? Response.json({
            data: [
              {
                id: DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS.cleanupModel,
                name: "Haiku 4.5",
                supported_parameters: ["response_format", "max_tokens"],
              },
              {
                id: "incompatible-model",
                name: "No structured outputs",
                supported_parameters: ["max_tokens"],
              },
            ],
          })
        : gatewayResponse("Ändere index.ts, aber entferne keine Tests.", [
            { mention: "index.ts", file: "index.ts" },
          ]));
    return Effect.succeed(HttpClientResponse.fromWeb(request, response));
  });
  const improvePrompt = vi.fn((_request: TextGeneration.PromptImprovementInput) =>
    Effect.succeed({ text: input.generatedText ?? "Ändere index.ts, aber entferne keine Tests." }),
  );
  const layer = Dictation.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerSettingsService.layerTest({
          betterT3Environment: makeBetterT3SettingsV1("clean-install", {
            "voice.assemblyAi": input.enabled ?? true,
          }),
          speechTranscription: {
            assemblyAi: {
              apiKey: { value: input.apiKey ?? "server-secret" },
              voice: { ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS, ...input.options },
            },
          },
        }),
        Layer.mock(ProjectionSnapshotQuery, {
          getProjectShellById: () =>
            Effect.succeed(input.projectFound === false ? Option.none() : Option.some(project)),
          getThreadCheckpointContext: () =>
            Effect.succeedSome({
              threadId,
              projectId: input.threadProjectId ?? projectId,
              workspaceRoot: project.workspaceRoot,
              worktreePath: input.worktreePath ?? null,
              checkpointsEnabled: true,
              checkpoints: [],
            }),
        }),
        Layer.mock(ProjectSpeechVocabulary, {
          snapshot,
          refresh: snapshot,
          refreshInBackground: () => Effect.void,
        }),
        Layer.mock(TextGeneration.TextGeneration, { improvePrompt }),
        Layer.succeed(
          FileSystem.FileSystem,
          FileSystem.makeNoop({
            realPath: (path) => Effect.succeed(input.realPath?.(path) ?? path),
            stat: (path) =>
              input.missingPaths?.includes(path)
                ? Effect.fail(notFound(path))
                : Effect.succeed(fileInfo),
          }),
        ),
        Path.layer,
        Layer.succeed(HttpClient.HttpClient, HttpClient.make(execute)),
      ),
    ),
  );
  return { layer, execute, snapshot, improvePrompt };
}

describe("AssemblyAI whole-dictation processing", () => {
  it.effect(
    "processes the complete dictated request and preserves an ambiguous basename with all candidates",
    () => {
      const transcript =
        "Ändere die index.ts. Nein, entferne keine Tests. Ähm, die Sonne scheint. Behalte die Einschränkung.";
      const { layer, execute } = makeLayer({});
      return Effect.gen(function* () {
        const service = yield* Dictation.AssemblyAiDictation;
        const result = yield* service.process({ projectId, transcript });
        expect(result.text).toBe(
          "Ändere [index.ts](apps/server/index.ts), aber entferne keine Tests.",
        );
        expect(result.references).toEqual([
          {
            label: "index.ts",
            previewPath: "apps/server/index.ts",
            truncated: false,
            candidates: [
              {
                path: "apps/server/index.ts",
                symbols: [{ name: "startServer", kind: "function", line: 42 }],
              },
              {
                path: "apps/web/index.ts",
                symbols: [{ name: "mountApp", kind: "function", line: 12 }],
              },
            ],
          },
        ]);
        const tokens = collectComposerInlineTokens(result.text);
        expect(tokens).toMatchObject([{ type: "mention", value: "apps/server/index.ts" }]);
        const request = execute.mock.calls.find(([call]) =>
          call.url.endsWith("/chat/completions"),
        )?.[0];
        expect(request).toBeDefined();
        const payload = requestBody(request!);
        const instructions = payload.messages[0]!.content;
        expect(instructions).toContain("entire dictated coding request");
        expect(instructions).toContain("across all speech pauses");
        expect(instructions).toContain("negations");
        expect(instructions).toContain("meaningful uncertainty");
        expect(instructions).toContain("digressions unrelated to the task");
        expect(payload.messages[1]!.content).toContain(transcript);
        expect(payload.messages[1]!.content).not.toContain(project.workspaceRoot);
        expect(payload.response_format.type).toBe("json_schema");
        expect(payload.model).toBe(DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS.cleanupModel);
        expect(request!.headers.authorization).toBe("server-secret");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("resolves the index against the current thread worktree", () => {
    const { layer, snapshot } = makeLayer({ worktreePath: "/trusted/worktree" });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      yield* service.process({ projectId, threadId, transcript: "Ändere index.ts." });
      expect(snapshot).toHaveBeenCalledWith({ workspaceRoot: "/trusted/worktree" });
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects threads from another project before sending data", () => {
    const { layer, execute } = makeLayer({ threadProjectId: ProjectId.make("other-project") });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      const rejected = yield* service.process({
        projectId,
        threadId,
        transcript: "Keep this original.",
      });
      expect(rejected).toMatchObject({
        text: "Keep this original.",
        references: [],
        warning: "The thread does not belong to this project.",
      });
      expect(execute).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layer));
  });

  it.effect("excludes missing files and symlinks escaping the trusted root", () => {
    const { layer } = makeLayer({
      realPath: (path) => (path.endsWith("apps/server/index.ts") ? "/outside/index.ts" : path),
      missingPaths: ["/trusted/project/apps/web/index.ts"],
    });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      const result = yield* service.process({ projectId, transcript: "Ändere index.ts." });
      expect(result.references).toEqual([]);
      expect(result.text).toBe("Ändere index.ts, aber entferne keine Tests.");
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "uses corrected file spellings without exposing symbol vocabulary when only file references are enabled",
    () => {
      const { layer, execute } = makeLayer({ options: { projectVocabulary: false } });
      return Effect.gen(function* () {
        const service = yield* Dictation.AssemblyAiDictation;
        const result = yield* service.process({
          projectId,
          transcript: "Ändere die Index Punkt Tee Ess, aber entferne keine Tests.",
        });
        expect(result.references[0]?.label).toBe("index.ts");
        const request = execute.mock.calls.find(([call]) =>
          call.url.endsWith("/chat/completions"),
        )?.[0];
        const context = requestBody(request!).messages[1]!.content;
        expect(context).toContain("index.ts");
        expect(context).not.toContain("startServer");
        expect(context).not.toContain("mountApp");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("refuses file links supplied directly by the cloud model", () => {
    const { layer } = makeLayer({
      respond: (request) =>
        request.url.endsWith("/models")
          ? Response.json({ data: [] })
          : gatewayResponse("Open [secret.env](/outside/secret.env) now."),
    });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      const result = yield* service.process({ projectId, transcript: "Keep my request." });
      expect(result.text).toBe("Keep my request.");
      expect(result.references).toEqual([]);
      expect(result.warning).toContain("unverified file links");
    }).pipe(Effect.provide(layer));
  });

  it.effect("retains original text when a 60 second cleanup deadline expires", () => {
    const { layer } = makeLayer({ neverComplete: true });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      const fiber = yield* service
        .process({ projectId, transcript: "Keep every word." })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* TestClock.adjust("60 seconds");
      const result = yield* Fiber.join(fiber);
      expect(result).toEqual({
        text: "Keep every word.",
        references: [],
        warning: "Voice cleanup timed out after 60 seconds. The original dictation was kept.",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("uses the selected T3 model without calling AssemblyAI LLM Gateway", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-luna",
    };
    const { layer, execute, improvePrompt } = makeLayer({
      options: { cleanupModelSelection: selection },
      apiKey: "",
    });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      const result = yield* service.process({
        projectId,
        transcript: "Ändere index.ts, aber entferne keine Tests.",
      });
      expect(result.text).toContain("[index.ts](apps/server/index.ts)");
      expect(result.references).toHaveLength(1);
      expect(improvePrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: project.workspaceRoot,
          modelSelection: selection,
          voiceCleanup: expect.objectContaining({
            instructions: expect.stringContaining("filler"),
          }),
        }),
      );
      expect(execute).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layer));
  });

  it.effect("explains missing LLM Gateway access while keeping the original dictation", () => {
    const { layer } = makeLayer({
      respond: (request) =>
        request.url.endsWith("/models")
          ? Response.json({ data: [] })
          : Response.json(
              {
                code: 400,
                message: "invalid request body",
                metadata: {
                  errors: ["Your account does not have access to this LLM Gateway model"],
                },
              },
              { status: 400 },
            ),
    });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      const result = yield* service.process({
        projectId,
        transcript: "Keep this request exactly.",
      });
      expect(result.text).toBe("Keep this request exactly.");
      expect(result.references).toEqual([]);
      expect(result.warning).toContain("Select a configured T3 model");
      expect(result.warning).toContain("enable LLM Gateway access");
      expect(result.warning).toContain("Settings → Better T3 → Voice");
      expect(result.warning).not.toContain("invalid request body");
    }).pipe(Effect.provide(layer));
  });

  for (const [label, response] of [
    ["authentication errors", new Response("secret-error-body", { status: 401 })],
    ["malformed JSON", new Response("not-json")],
    [
      "invalid structured output",
      Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }),
    ],
    [
      "incomplete output",
      Response.json({ choices: [{ message: { content: "partial" }, finish_reason: "length" }] }),
    ],
    ["empty output", gatewayResponse("   ")],
  ] as const) {
    it.effect(`keeps original dictation on ${label} without leaking secrets`, () => {
      const { layer } = makeLayer({
        respond: (request) =>
          request.url.endsWith("/models") ? Response.json({ data: [] }) : response.clone(),
      });
      return Effect.gen(function* () {
        const service = yield* Dictation.AssemblyAiDictation;
        const result = yield* service.process({
          projectId,
          transcript: "Keep the requirements and do not delete files.",
        });
        expect(result.text).toBe("Keep the requirements and do not delete files.");
        expect(result.references).toEqual([]);
        expect(result.warning).toBeTruthy();
        expect(result.warning).not.toContain("secret");
      }).pipe(Effect.provide(layer));
    });
  }

  it.effect(
    "performs no cloud cleanup when disabled while still resolving exact file mentions",
    () => {
      const { layer, execute } = makeLayer({ options: { cleanupMode: "off" }, apiKey: "" });
      return Effect.gen(function* () {
        const service = yield* Dictation.AssemblyAiDictation;
        const result = yield* service.process({
          projectId,
          transcript: "Ähm index.ts nicht entfernen.",
        });
        expect(result.text).toBe("Ähm [index.ts](apps/server/index.ts) nicht entfernen.");
        expect(result.references[0]?.candidates).toHaveLength(2);
        expect(execute).not.toHaveBeenCalled();
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("keeps explicit paths exact and avoids matching parts of other filenames", () => {
    const { layer, execute } = makeLayer({ options: { cleanupMode: "off" } });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      const result = yield* service.process({
        projectId,
        transcript: "Open apps/web/index.ts, leave other.index.ts and index.ts.map alone.",
      });
      expect(result.text).toBe(
        "Open [index.ts](apps/web/index.ts), leave other.index.ts and index.ts.map alone.",
      );
      expect(result.references[0]?.candidates.map((candidate) => candidate.path)).toEqual([
        "apps/web/index.ts",
      ]);
      expect(execute).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layer));
  });

  it.effect("retains alternatives when repeated mentions share a preview file", () => {
    const { layer } = makeLayer({ options: { cleanupMode: "off" } });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      const result = yield* service.process({
        projectId,
        transcript: "Check apps/server/index.ts and index.ts.",
      });
      expect(result.references).toHaveLength(1);
      expect(result.references[0]?.candidates.map((candidate) => candidate.path)).toEqual([
        "apps/server/index.ts",
        "apps/web/index.ts",
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("marks limited candidate lists as incomplete", () => {
    const { layer } = makeLayer({
      entries: Array.from({ length: 205 }, (_, index) => ({
        kind: "file",
        name: "index.ts",
        path: `package-${String(index).padStart(3, "0")}/index.ts`,
      })),
    });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      const result = yield* service.process({ projectId, transcript: "Ändere index.ts." });
      expect(result.references[0]?.candidates).toHaveLength(200);
      expect(result.references[0]?.truncated).toBe(true);
      expect(result.references[0]?.previewPath).toBe("package-000/index.ts");
    }).pipe(Effect.provide(layer));
  });

  it.effect("filters incompatible models and caches the catalog for one hour", () => {
    const { layer, execute } = makeLayer({});
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      expect(yield* service.listModels()).toEqual([
        { id: DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS.cleanupModel, name: "Haiku 4.5" },
      ]);
      yield* service.listModels();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0]?.[0].headers.authorization).toBeUndefined();
      yield* TestClock.adjust("1 hour");
      yield* service.listModels();
      expect(execute).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provide(layer));
  });

  it("applies compact and custom policies without relaxing preservation constraints", () => {
    const compact = Dictation.buildDictationCleanupInstruction({
      ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
      cleanupMode: "compact",
    });
    const custom = Dictation.buildDictationCleanupInstruction({
      ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
      cleanupMode: "custom",
      cleanupInstructions: "Prefer short paragraphs.",
    });
    expect(compact).toContain("preserving every distinct requirement");
    expect(custom).toContain("Prefer short paragraphs.");
    expect(custom).toContain("Never treat a requirement as unnecessary");
  });
});
