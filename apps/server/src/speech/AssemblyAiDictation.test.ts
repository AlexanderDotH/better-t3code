const decodeThread = Schema.decodeUnknownSync(OrchestrationV2AppThreadJson);
import * as ByteSize from "effect/ByteSize";
import { describe, expect, it, vi } from "@effect/vitest";
import {
  DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
  type AssemblyAiVoiceSettings,
  type OrchestrationProjectShell,
  ProjectId,
  OrchestrationV2AppThreadJson,
  ProviderInstanceId,
  ThreadId,
  type SpeechVocabularyEntry,
  type AssemblyAiSpeechContext,
  makeBetterT3SettingsV1,
  TextGenerationError,
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
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Dictation from "./AssemblyAiDictation.ts";
import { ProjectSpeechVocabulary } from "./ProjectSpeechVocabulary.ts";
import * as ProjectSpeechProfiles from "./ProjectSpeechProfiles.ts";
import { AssemblyAiStreamingToken } from "./Layers/AssemblyAiStreamingToken.ts";
import * as Vocabulary from "./ProjectSpeechVocabulary.ts";
import * as ProjectSpeechWorkspaceScanner from "./ProjectSpeechWorkspaceScanner.ts";
import { ServerConfig, layerTest as serverConfigLayerTest } from "../config.ts";

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
  dev: 1n,
  ino: Option.none(),
  mode: 0o644,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: ByteSize.bytes(10),
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
  readonly generate?: TextGeneration.TextGeneration["Service"]["improvePrompt"];
  readonly vocabulary?: ProjectSpeechVocabulary["Service"];
}) {
  const refreshInBackground = vi.fn((_input: { workspaceRoot: string }) => Effect.void);
  const learn = vi.fn(() => Effect.void);
  const createStreamingToken = vi.fn((context: AssemblyAiSpeechContext) =>
    Effect.succeed({
      token: "ephemeral-token",
      websocketUrl: "wss://streaming.example.test/v3/ws",
      expiresInSeconds: 60,
      sampleRate: 16_000,
      encoding: "pcm_s16le" as const,
      speechModel: "universal-3-5-pro" as const,
      context,
    }),
  );
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
  const improvePrompt = vi.fn(
    (_request: TextGeneration.PromptImprovementInput) =>
      input.generate?.(_request) ??
      Effect.succeed({
        text: input.generatedText ?? "Ändere index.ts, aber entferne keine Tests.",
      }),
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
        Layer.mock(ProjectStoreV2, {
          getShell: () =>
            Effect.succeed(input.projectFound === false ? Option.none() : Option.some(project)),
        }),
        Layer.mock(ProjectionStoreV2, {
          getThread: () =>
            Effect.succeed(
              decodeThread({
                id: threadId,
                title: "Voice tests",
                providerInstanceId: "codex",
                modelSelection: { instanceId: "codex", model: "gpt-6-luna" },
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                activeProviderThreadId: null,
                forkedFrom: null,
                lineage: {
                  parentThreadId: null,
                  relationshipToParent: null,
                  rootThreadId: threadId,
                },
                createdBy: "user",
                creationSource: "web",
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
                archivedAt: null,
                deletedAt: null,
                projectId: input.threadProjectId ?? projectId,
                workspaceRoot: project.workspaceRoot,
                worktreePath: input.worktreePath ?? null,
                checkpointsEnabled: true,
                checkpoints: [],
              }),
            ),
        }),
        Layer.mock(ProjectSpeechVocabulary, {
          snapshot,
          refresh: snapshot,
          refreshInBackground,
          learnedTerms: () => Effect.succeed(["mountApp"]),
          learn,
          ...input.vocabulary,
        }),
        Layer.mock(ProjectSpeechProfiles.ProjectSpeechProfiles, {
          contextForProject: () =>
            Effect.succeed({
              source: "indexed",
              prompt: "Software development.",
              keyterms: ["Voice tests"],
            }),
        }),
        Layer.mock(AssemblyAiStreamingToken, { create: createStreamingToken }),
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
  return {
    layer,
    execute,
    snapshot,
    improvePrompt,
    refreshInBackground,
    learn,
    createStreamingToken,
  };
}

describe("AssemblyAI whole-dictation processing", () => {
  it.effect(
    "submits the complete PCM recording with supported model, language, and vocabulary options",
    () => {
      const fixture = makeLayer({ respond: () => Response.json({ text: "Keep mountApp." }) });
      return Effect.gen(function* () {
        const service = yield* Dictation.AssemblyAiDictation;
        const config = yield* service.createStreamingConfiguration({ projectId });
        const audio = new Uint8Array([1, 2, 3, 4]);
        const result = yield* service.transcribeRecording({
          model: "universal-3-6-pro",
          audio,
          config: {
            ...config,
            options: { ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS, languageCodes: ["de", "en"] },
          },
        });
        expect(result).toBe("Keep mountApp.");
        const request = fixture.execute.mock.calls[0]![0];
        expect(request.url).toBe("https://sync.assemblyai.com/v1/transcribe");
        expect(request.headers["x-aai-model"]).toBe("universal-3-6-pro");
        if (request.body._tag !== "FormData") throw new Error("Expected multipart audio");
        const form = request.body.formData;
        const uploaded = form.get("audio");
        const options = form.get("config");
        if (!(uploaded instanceof Blob) || !(options instanceof Blob))
          throw new Error("Expected audio and configuration parts");
        expect(new Uint8Array(yield* Effect.promise(() => uploaded.arrayBuffer()))).toEqual(audio);
        expect(uploaded.type).toBe("audio/pcm");
        const decodeConfig = Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              sample_rate: Schema.Number,
              channels: Schema.Number,
              language_codes: Schema.Array(Schema.String),
              keyterms_prompt: Schema.Array(Schema.String),
            }),
          ),
        );
        const body = yield* decodeConfig(yield* Effect.promise(() => options.text()));
        expect(body).toMatchObject({
          sample_rate: 16_000,
          channels: 1,
          language_codes: ["de", "en"],
        });
        expect(body.keyterms_prompt).toContain("mountApp");
      }).pipe(Effect.provide(fixture.layer));
    },
  );

  it.effect(
    "uses the default small gateway model for interpretation even with cleanup disabled",
    () => {
      const fixture = makeLayer({
        options: { advancedMode: true, cleanupMode: "off", automaticFileReferences: false },
        respond: (request) =>
          request.url.endsWith("/models")
            ? Response.json({ data: [] })
            : gatewayResponse("Keep mountApp."),
      });
      return Effect.gen(function* () {
        const service = yield* Dictation.AssemblyAiDictation;
        const result = yield* service.process({
          projectId,
          transcript: "Keep mount app.",
          additionalTranscripts: ["Keep mountApp.", "Keep mountApp"],
        });
        expect(result).toEqual({ text: "Keep mountApp.", references: [] });
        const requests = fixture.execute.mock.calls.filter(([request]) =>
          request.url.endsWith("/chat/completions"),
        );
        expect(requests).toHaveLength(1);
        expect(requestBody(requests[0]![0]).model).toBe(
          DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS.interpretationModel,
        );
      }).pipe(Effect.provide(fixture.layer));
    },
  );
  it.effect(
    "reconciles three passes with the selected model and vocabulary before one cleanup",
    () => {
      const selection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
      const fixture = makeLayer({
        options: { advancedMode: true, interpretationModelSelection: selection },
        generatedText: "Ändere mountApp in index.ts, aber entferne keine Tests.",
      });
      return Effect.gen(function* () {
        const service = yield* Dictation.AssemblyAiDictation;
        const transcript = "Ändere mount app in index ts, aber entferne keine Tests.";
        const additionalTranscripts = [
          "Ändere mountApp in index.ts, aber entferne keine Tests.",
          "Ändere mountApp in index.ts. Entferne keine Tests.",
        ] as const;
        const result = yield* service.process({ projectId, transcript, additionalTranscripts });
        expect(fixture.improvePrompt).toHaveBeenCalledOnce();
        const request = fixture.improvePrompt.mock.calls[0]![0];
        expect(request.modelSelection).toEqual(selection);
        expect(request.text).toContain(transcript);
        for (const alternative of additionalTranscripts)
          expect(request.text).toContain(alternative);
        expect(request.voiceCleanup?.instructions).toContain("agreement");
        expect(request.voiceCleanup?.instructions).toContain("Do not answer");
        expect(request.voiceCleanup?.instructions).toContain("Never invent");
        expect(request.voiceCleanup?.context).toContain("mountApp");
        const cleanup = fixture.execute.mock.calls.filter(([call]) =>
          call.url.endsWith("/chat/completions"),
        );
        expect(cleanup).toHaveLength(1);
        expect(requestBody(cleanup[0]![0]).messages[1]!.content).toContain(
          "Ändere mountApp in index.ts",
        );
        expect(result.warning).toBeUndefined();
        expect(result.references).toHaveLength(1);
      }).pipe(Effect.provide(fixture.layer));
    },
  );

  it.effect.each(["failure", "timeout", "empty", "links"] as const)(
    "keeps the live transcript on interpreter %s and still cleans it once",
    (failure) => {
      const fixture = makeLayer({
        options: {
          advancedMode: true,
          interpretationModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-6-luna",
          },
          automaticFileReferences: false,
        },
        generate: () =>
          failure === "timeout"
            ? Effect.never
            : failure === "failure"
              ? Effect.fail(
                  new TextGenerationError({
                    operation: "improvePrompt",
                    detail: "Model unavailable",
                  }),
                )
              : Effect.succeed({
                  text: failure === "empty" ? "" : "Read [secret.env](/outside/secret.env).",
                }),
      });
      return Effect.gen(function* () {
        const service = yield* Dictation.AssemblyAiDictation;
        const fiber = yield* service
          .process({
            projectId,
            transcript: "Keep every word.",
            additionalTranscripts: ["Keep every word", "Keep all words"],
          })
          .pipe(Effect.forkChild({ startImmediately: true }));
        if (failure === "timeout") yield* TestClock.adjust("15 seconds");
        const result = yield* Fiber.join(fiber);
        expect(result.warning).toContain("interpretation");
        const cleanup = fixture.execute.mock.calls.filter(([call]) =>
          call.url.endsWith("/chat/completions"),
        );
        expect(cleanup).toHaveLength(1);
        expect(requestBody(cleanup[0]![0]).messages[1]!.content).toContain("Keep every word.");
      }).pipe(Effect.provide(fixture.layer));
    },
  );
  it.effect("gives learned terms priority in capped streaming keyterms and cleanup context", () => {
    const fixture = makeLayer({
      entries: Array.from({ length: 150 }, (_, index) => ({
        kind: "class",
        name: `Unrelated${index}`,
        path: `src/${index}.ts`,
        line: 1,
      })),
      options: { automaticFileReferences: false },
    });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      const streaming = yield* service.createStreamingConfiguration({ projectId });
      expect(streaming.context.keyterms[0]).toBe("mountApp");
      expect(streaming.context.keyterms).toHaveLength(100);
      yield* service.process({ projectId, transcript: "Fix mount app." });
      const request = fixture.execute.mock.calls.find(([call]) =>
        call.url.endsWith("/chat/completions"),
      )![0];
      expect(requestBody(request).messages[1]!.content).toContain("mountApp");
      expect(fixture.learn).toHaveBeenCalledWith(
        expect.objectContaining({ projectId, transcript: "Fix mount app." }),
      );
    }).pipe(Effect.provide(fixture.layer));
  });
  it.effect("sends a file change between two dictations to the next cleanup", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "t3-dictation-refresh-" });
      const root = path.join(temporary, "project");
      yield* fs.makeDirectory(root);
      yield* fs.writeFileString(path.join(root, "Voice.ts"), "export class BeforeRename {}");
      const config = yield* ServerConfig.pipe(
        Effect.provide(serverConfigLayerTest(root, temporary)),
      );
      const vocabulary = yield* Vocabulary.make.pipe(
        Effect.provideService(ServerConfig, config),
        Effect.provide(ProjectSpeechWorkspaceScanner.layer),
      );
      const fixture = makeLayer({
        vocabulary: {
          ...vocabulary,
          snapshot: (input) => vocabulary.snapshot({ ...input, workspaceRoot: root }),
          refresh: () => vocabulary.refresh({ workspaceRoot: root }),
          refreshInBackground: () => vocabulary.refreshInBackground({ workspaceRoot: root }),
        },
        options: { automaticFileReferences: false },
      });
      yield* Effect.gen(function* () {
        const service = yield* Dictation.AssemblyAiDictation;
        yield* service.process({ projectId, transcript: "Before Rename" });
        yield* fs.writeFileString(path.join(root, "Voice.ts"), "export class AfterRename {}");
        yield* TestClock.adjust("1 minute");
        yield* service.process({ projectId, transcript: "After Rename" });
        const requests = fixture.execute.mock.calls.filter(([request]) =>
          request.url.endsWith("/chat/completions"),
        );
        expect(requests).toHaveLength(2);
        expect(requestBody(requests[0]![0]).messages[1]!.content).toContain("BeforeRename");
        expect(requestBody(requests[1]![0]).messages[1]!.content).toContain("AfterRename");
        expect(requestBody(requests[1]![0]).messages[1]!.content).not.toContain("BeforeRename");
      }).pipe(Effect.provide(fixture.layer));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  it.effect("refreshes a non-empty vocabulary before selecting cleanup context", () => {
    const { layer, execute, snapshot, refreshInBackground } = makeLayer({
      options: { automaticFileReferences: false },
    });
    return Effect.gen(function* () {
      const service = yield* Dictation.AssemblyAiDictation;
      yield* service.process({ projectId, transcript: "Ändere mountApp." });
      expect(refreshInBackground).toHaveBeenCalledWith({ workspaceRoot: project.workspaceRoot });
      expect(snapshot).toHaveBeenCalledWith({
        workspaceRoot: project.workspaceRoot,
        awaitRefresh: true,
      });
      expect(execute).toHaveBeenCalled();
    }).pipe(Effect.provide(layer));
  });
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
      expect(snapshot).toHaveBeenCalledWith({
        workspaceRoot: "/trusted/worktree",
        awaitRefresh: true,
      });
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

  it.effect.each(
    (
      [
        ["authentication errors", new Response("secret-error-body", { status: 401 })],
        ["malformed JSON", new Response("not-json")],
        [
          "invalid structured output",
          Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }),
        ],
        [
          "incomplete output",
          Response.json({
            choices: [{ message: { content: "partial" }, finish_reason: "length" }],
          }),
        ],
        ["empty output", gatewayResponse("   ")],
      ] as const
    ).map(([label, response]) => ({ label, response })),
  )("keeps original dictation on $label without leaking secrets", ({ response }) => {
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
