// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  type CodexSettings,
  DEFAULT_TEXT_GENERATION_REASONING_EFFORT,
  type ModelSelection,
  TextGenerationError,
  type TextGenerationModelFailureReason,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import { expandHomePath } from "../pathExpansion.ts";
import { codexExecLaunchArgs, resolveCodexLaunchArgs } from "../provider/Layers/codexLaunchArgs.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildFetchExplorationPrompt,
  buildPlanParallelismReviewPrompt,
  buildPromptImprovementPrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
  buildThreadMetadataPrompt,
  buildTranscriptTranslationPrompt,
} from "./TextGenerationPrompts.ts";
import {
  normalizeCliError,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils.ts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { getCodexServiceTierOptionValue } from "../codexModelOptions.ts";
import { codexExecArgs } from "../provider/CodexProcessArgs.ts";
import { buildAutoReasoningPrompt, validateAutoReasoningDecision } from "./AutoReasoning.ts";

const CODEX_TIMEOUT_MS = 180_000;
const encodeJsonString = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const isTextGenerationError = Schema.is(TextGenerationError);

export function classifyCodexTextGenerationModelFailure(
  detail: string,
): TextGenerationModelFailureReason | undefined {
  if (/\byou(?:'|\u2019)ve hit your usage limit\b/iu.test(detail)) {
    return "rate-limited";
  }
  if (
    /(?:do not have access|not entitled|not enabled|not supported).*\b(?:account|subscription)\b|\b(?:account|subscription)\b.*(?:does not include|lacks access)/iu.test(
      detail,
    )
  ) {
    return "entitlement";
  }
  if (
    /(?:\bmodel\b.*\b(?:not found|does not exist|unknown|unsupported|not supported|unavailable|not available)\b|\binvalid model\b)/iu.test(
      detail,
    )
  ) {
    return "model-unavailable";
  }
  return undefined;
}
/**
 * Build a Codex text-generation closure bound to a specific `CodexSettings`
 * payload. See `makeCodexAdapter` for the overall per-instance rationale.
 */
export const makeCodexTextGeneration = Effect.fn("makeCodexTextGeneration")(function* (
  codexConfig: CodexSettings,
  environment?: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const resolvedEnvironment = environment ?? process.env;

  const readStreamAsString = <E>(
    operation: string,
    stream: Stream.Stream<Uint8Array, E>,
  ): Effect.Effect<string, TextGenerationError> =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runFold(
        () => "",
        (acc, chunk) => acc + chunk,
      ),
      Effect.mapError((cause) =>
        normalizeCliError("codex", operation, cause, "Failed to collect process output"),
      ),
    );

  const writeTempFile = (
    operation: string,
    prefix: string,
    content: string,
  ): Effect.Effect<string, TextGenerationError, Scope.Scope> =>
    fileSystem
      .makeTempFileScoped({
        prefix: `t3code-${prefix}-${process.pid}-`,
      })
      .pipe(
        Effect.tap((filePath) => fileSystem.writeFileString(filePath, content)),
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: `Failed to write temp file`,
              cause,
            }),
        ),
      );

  const safeUnlink = (filePath: string): Effect.Effect<void, never> =>
    fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));

  const encodeJsonForOperation = (
    operation:
      | "decideAutoReasoning"
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadMetadata"
      | "generateThreadTitle"
      | "translateTranscriptToEnglish"
      | "improvePrompt"
      | "reviewPlanParallelism"
      | "planFetchExploration",
    value: unknown,
  ): Effect.Effect<string, TextGenerationError> =>
    encodeJsonString(value).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: "Failed to encode structured output schema.",
            cause,
          }),
      ),
    );

  const runCodexJson = Effect.fn("runCodexJson")(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    cleanupPaths = [],
    modelSelection,
    isolatedHome,
  }: {
    operation:
      | "decideAutoReasoning"
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadMetadata"
      | "generateThreadTitle"
      | "translateTranscriptToEnglish"
      | "improvePrompt"
      | "reviewPlanParallelism"
      | "planFetchExploration";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    cleanupPaths?: ReadonlyArray<string>;
    modelSelection: ModelSelection;
    isolatedHome?: string;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const schemaJson = yield* encodeJsonForOperation(
      operation,
      toJsonSchemaObject(outputSchemaJson),
    );
    const schemaPath = yield* writeTempFile(operation, "codex-schema", schemaJson);
    const outputPath = yield* writeTempFile(operation, "codex-output", "");

    const runCodexCommand = Effect.fn("runCodexJson.runCodexCommand")(function* () {
      const launchArgs = isolatedHome
        ? ""
        : resolveCodexLaunchArgs(codexConfig.launchArgs, resolvedEnvironment);
      const reasoningEffort =
        getModelSelectionStringOptionValue(modelSelection, "reasoningEffort") ??
        DEFAULT_TEXT_GENERATION_REASONING_EFFORT;
      const serviceTier = getCodexServiceTierOptionValue(modelSelection);
      const spawnCommand = yield* resolveSpawnCommand(
        codexConfig.binaryPath || "codex",
        codexExecArgs([
          ...codexExecLaunchArgs(launchArgs),
          ...(operation === "planFetchExploration" || operation === "decideAutoReasoning"
            ? [
                "--disable",
                "multi_agent",
                "-c",
                "mcp_servers={}",
                "-c",
                "memories.use_memories=false",
                "-c",
                "memories.generate_memories=false",
              ]
            : []),
          "--ephemeral",
          "--skip-git-repo-check",
          "-s",
          "read-only",
          "--model",
          modelSelection.model,
          "--config",
          `model_reasoning_effort="${reasoningEffort}"`,
          ...(serviceTier ? ["--config", `service_tier="${serviceTier}"`] : []),
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          "-",
        ]),
        { env: resolvedEnvironment },
      );
      const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: {
          ...resolvedEnvironment,
          ...(isolatedHome
            ? { CODEX_HOME: isolatedHome }
            : codexConfig.homePath
              ? { CODEX_HOME: expandHomePath(codexConfig.homePath) }
              : {}),
        },
        cwd,
        shell: spawnCommand.shell,
        stdin: {
          stream: Stream.encodeText(Stream.make(prompt)),
        },
      });

      const child = yield* commandSpawner
        .spawn(command)
        .pipe(
          Effect.mapError((cause) =>
            normalizeCliError("codex", operation, cause, "Failed to spawn Codex CLI process"),
          ),
        );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          readStreamAsString(operation, child.stdout),
          readStreamAsString(operation, child.stderr),
          child.exitCode.pipe(
            Effect.mapError((cause) =>
              normalizeCliError("codex", operation, cause, "Failed to read Codex CLI exit code"),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      if (exitCode !== 0) {
        const stderrDetail = stderr.trim();
        const stdoutDetail = stdout.trim();
        const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
        const reason = classifyCodexTextGenerationModelFailure(detail);
        return yield* new TextGenerationError({
          operation,
          detail:
            detail.length > 0
              ? `Codex CLI command failed: ${detail}`
              : `Codex CLI command failed with code ${exitCode}.`,
          ...(reason ? { reason } : {}),
        });
      }
    });

    const cleanup = Effect.all(
      [schemaPath, outputPath, ...cleanupPaths].map((filePath) => safeUnlink(filePath)),
      {
        concurrency: "unbounded",
      },
    ).pipe(Effect.asVoid);

    return yield* Effect.gen(function* () {
      yield* runCodexCommand().pipe(
        Effect.scoped,
        Effect.timeoutOption(CODEX_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({ operation, detail: "Codex CLI request timed out." }),
              ),
            onSome: () => Effect.void,
          }),
        ),
      );

      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));

      return yield* fileSystem.readFileString(outputPath).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: "Failed to read Codex output file.",
              cause,
            }),
        ),
        Effect.flatMap(decodeOutput),
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Codex returned invalid structured output.",
                cause,
              }),
            ),
        }),
      );
    }).pipe(Effect.ensuring(cleanup));
  });

  const makeIsolatedCodexHome = Effect.fn("CodexTextGeneration.makeIsolatedCodexHome")(
    function* () {
      const home = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-auto-reasoning-codex-home-",
      });
      const configuredHome = codexConfig.homePath.trim()
        ? expandHomePath(codexConfig.homePath)
        : resolvedEnvironment.CODEX_HOME?.trim() ||
          NodePath.join(resolvedEnvironment.HOME?.trim() || NodeOS.homedir(), ".codex");
      const authSource = NodePath.join(configuredHome, "auth.json");
      if (yield* fileSystem.exists(authSource).pipe(Effect.orElseSucceed(() => false))) {
        yield* fileSystem.copyFile(authSource, NodePath.join(home, "auth.json")).pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation: "decideAutoReasoning",
                detail: "Failed to prepare isolated Codex credentials.",
                cause,
              }),
          ),
        );
      }
      yield* fileSystem
        .writeFileString(
          NodePath.join(home, "config.toml"),
          "mcp_servers = {}\n\n[features]\nmulti_agent = false\n",
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation: "decideAutoReasoning",
                detail: "Failed to prepare isolated Codex configuration.",
                cause,
              }),
          ),
        );
      return home;
    },
  );

  const decideAutoReasoning: TextGeneration.TextGeneration["Service"]["decideAutoReasoning"] =
    Effect.fn("CodexTextGeneration.decideAutoReasoning")(function* (input) {
      if (resolveCodexLaunchArgs(codexConfig.launchArgs, resolvedEnvironment).length > 0) {
        return yield* new TextGenerationError({
          operation: "decideAutoReasoning",
          detail: "Custom Codex launch arguments prevent isolated Auto Reasoning.",
        });
      }
      return yield* Effect.gen(function* () {
        const cwd = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3code-auto-reasoning-codex-cwd-",
        });
        const isolatedHome = yield* makeIsolatedCodexHome();
        const { prompt, outputSchema } = buildAutoReasoningPrompt(input);
        const generated = yield* runCodexJson({
          operation: "decideAutoReasoning",
          cwd,
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
          isolatedHome,
        });
        return yield* validateAutoReasoningDecision(input.allowedEfforts, generated);
      }).pipe(
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation: "decideAutoReasoning",
                detail: "Failed to prepare isolated Codex Auto Reasoning.",
                cause,
              }),
        ),
        Effect.scoped,
      );
    });

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("CodexTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });

      const generated = yield* runCodexJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("CodexTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });

      const generated = yield* runCodexJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("CodexTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* runCodexJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("CodexTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });

      const generated = yield* runCodexJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizeThreadTitle(generated.title),
      } satisfies TextGeneration.ThreadTitleGenerationResult;
    });

  const generateThreadMetadata: TextGeneration.TextGeneration["Service"]["generateThreadMetadata"] =
    Effect.fn("CodexTextGeneration.generateThreadMetadata")(function* (input) {
      const { prompt, outputSchema } = buildThreadMetadataPrompt(input);
      const generated = yield* runCodexJson({
        operation: "generateThreadMetadata",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
      return {
        title: sanitizeThreadTitle(generated.title),
        branch: sanitizeBranchFragment(generated.branch),
      };
    });

  const translateTranscriptToEnglish: TextGeneration.TextGeneration["Service"]["translateTranscriptToEnglish"] =
    Effect.fn("CodexTextGeneration.translateTranscriptToEnglish")(function* (input) {
      const { prompt, outputSchema } = buildTranscriptTranslationPrompt({ text: input.text });
      const generated = yield* runCodexJson({
        operation: "translateTranscriptToEnglish",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return { text: generated.text.trim() };
    });

  const improvePrompt: TextGeneration.TextGeneration["Service"]["improvePrompt"] = Effect.fn(
    "CodexTextGeneration.improvePrompt",
  )(function* (input) {
    const { prompt, outputSchema } = buildPromptImprovementPrompt({ text: input.text });
    const generated = yield* runCodexJson({
      operation: "improvePrompt",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return { text: generated.text.trim() };
  });

  const reviewPlanParallelism: TextGeneration.TextGeneration["Service"]["reviewPlanParallelism"] =
    Effect.fn("CodexTextGeneration.reviewPlanParallelism")(function* (input) {
      const { prompt, outputSchema } = buildPlanParallelismReviewPrompt(input);
      const generated = yield* runCodexJson({
        operation: "reviewPlanParallelism",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return { recommendedSubagents: generated.recommendedSubagents };
    });

  const planFetchExploration: TextGeneration.TextGeneration["Service"]["planFetchExploration"] =
    Effect.fn("CodexTextGeneration.planFetchExploration")(function* (input) {
      const { prompt, outputSchema } = buildFetchExplorationPrompt(input);
      return yield* runCodexJson({
        operation: "planFetchExploration",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });
    });

  return {
    decideAutoReasoning,
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadMetadata,
    generateThreadTitle,
    translateTranscriptToEnglish,
    improvePrompt,
    reviewPlanParallelism,
    planFetchExploration,
    enrichKnowledgeGraph: TextGeneration.unsupportedKnowledgeGraphEnrichment("Codex"),
  } satisfies TextGeneration.TextGeneration["Service"];
});
