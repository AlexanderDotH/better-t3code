/**
 * ClaudeTextGeneration – Text generation layer using the Claude CLI.
 *
 * Implements the same TextGeneration service contract as CodexTextGeneration but
 * delegates to the `claude` CLI (`claude -p`) with structured JSON output
 * instead of the `codex exec` CLI.
 *
 * @module ClaudeTextGeneration
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { type ClaudeSettings, type ModelSelection } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import { TextGenerationError } from "@t3tools/contracts";
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
import {
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import {
  getClaudeModelCapabilities,
  isClaudeUltracodeEffort,
  normalizeClaudeCliEffort,
  resolveClaudeApiModelId,
  resolveClaudeEffort,
} from "../provider/Layers/ClaudeProvider.ts";
import { makeClaudeEnvironment } from "../provider/Drivers/ClaudeHome.ts";
import type { ClaudeGatewayModelProfile } from "../provider/Drivers/ClaudeGatewayCatalog.ts";
import { resolveClaudeConfigDir } from "../provider/Drivers/ClaudeHome.ts";
import { buildAutoReasoningPrompt, validateAutoReasoningDecision } from "./AutoReasoning.ts";

const CLAUDE_TIMEOUT_MS = 180_000;
const isTextGenerationError = Schema.is(TextGenerationError);

export interface ClaudeTextGenerationOptions {
  readonly resolveGatewayModelProfile?: (
    modelId: string | null | undefined,
  ) => Effect.Effect<ClaudeGatewayModelProfile | undefined>;
}

/**
 * Schema for the wrapper JSON returned by `claude -p --output-format json`.
 * We only care about `structured_output`.
 */
const ClaudeOutputEnvelope = Schema.Struct({
  structured_output: Schema.Unknown,
});

const encodeJsonString = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeClaudeOutputEnvelope = Schema.decodeEffect(Schema.fromJsonString(ClaudeOutputEnvelope));

export const makeClaudeTextGeneration = Effect.fn("makeClaudeTextGeneration")(function* (
  claudeSettings: ClaudeSettings,
  environment?: NodeJS.ProcessEnv,
  options?: ClaudeTextGenerationOptions,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
  const claudeConfigDir = yield* resolveClaudeConfigDir(claudeSettings);

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
        normalizeCliError("claude", operation, cause, "Failed to collect process output"),
      ),
    );

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
    detail: string,
  ): Effect.Effect<string, TextGenerationError> =>
    encodeJsonString(value).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail,
            cause,
          }),
      ),
    );

  /**
   * Spawn the Claude CLI with structured JSON output and return the parsed,
   * schema-validated result.
   */
  const runClaudeJson = Effect.fn("runClaudeJson")(function* <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
    environmentOverride,
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
    modelSelection: ModelSelection;
    environmentOverride?: NodeJS.ProcessEnv;
  }): Effect.fn.Return<S["Type"], TextGenerationError, S["DecodingServices"]> {
    const jsonSchemaStr = yield* encodeJsonForOperation(
      operation,
      toJsonSchemaObject(outputSchemaJson),
      "Failed to encode structured output schema.",
    );
    const gatewayProfile = options?.resolveGatewayModelProfile
      ? yield* options.resolveGatewayModelProfile(modelSelection.model)
      : undefined;
    const caps = gatewayProfile?.capabilities ?? getClaudeModelCapabilities(modelSelection.model);
    const descriptors = getProviderOptionDescriptors({
      caps,
      selections: modelSelection.options,
    });
    const findDescriptor = (id: string) => descriptors.find((descriptor) => descriptor.id === id);
    const rawEffortSelection = getModelSelectionStringOptionValue(modelSelection, "effort");
    const resolvedEffort =
      resolveClaudeEffort(caps, rawEffortSelection) ?? gatewayProfile?.defaultEffort;
    const cliEffort = normalizeClaudeCliEffort(resolvedEffort, modelSelection.model, caps);
    const ultracode = isClaudeUltracodeEffort(resolvedEffort);
    const thinkingDescriptor = findDescriptor("thinking");
    const fastModeDescriptor = findDescriptor("fastMode");
    const thinking =
      thinkingDescriptor?.type === "boolean" ? thinkingDescriptor.currentValue : undefined;
    const fastMode =
      fastModeDescriptor?.type === "boolean" ? fastModeDescriptor.currentValue : undefined;
    const settings = {
      ...(operation === "decideAutoReasoning" ? { disableAllHooks: true } : {}),
      ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
      ...(!gatewayProfile && typeof fastMode === "boolean" ? { fastMode } : {}),
      ...(ultracode ? { ultracode: true } : {}),
    };
    const settingsJson =
      Object.keys(settings).length > 0
        ? yield* encodeJsonForOperation(
            operation,
            settings,
            "Failed to encode Claude CLI settings.",
          )
        : undefined;

    const runClaudeCommand = Effect.fn("runClaudeJson.runClaudeCommand")(function* () {
      const commandEnvironment = environmentOverride ?? claudeEnvironment;
      const spawnCommand = yield* resolveSpawnCommand(
        claudeSettings.binaryPath || "claude",
        [
          "-p",
          "--output-format",
          "json",
          "--json-schema",
          jsonSchemaStr,
          "--model",
          gatewayProfile
            ? fastMode === true && gatewayProfile.fastModelId
              ? gatewayProfile.fastModelId
              : gatewayProfile.baseModelId
            : resolveClaudeApiModelId(modelSelection),
          ...(cliEffort ? ["--effort", cliEffort] : []),
          ...(settingsJson ? ["--settings", settingsJson] : []),
          ...(operation === "decideAutoReasoning"
            ? [
                "--disallowedTools",
                "*",
                "--setting-sources",
                "",
                "--strict-mcp-config",
                "--mcp-config",
                "{}",
              ]
            : operation === "planFetchExploration"
              ? ["--disallowedTools", "*"]
              : ["--dangerously-skip-permissions"]),
        ],
        { env: commandEnvironment },
      );
      const command = ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: commandEnvironment,
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
            normalizeCliError("claude", operation, cause, "Failed to spawn Claude CLI process"),
          ),
        );

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          readStreamAsString(operation, child.stdout),
          readStreamAsString(operation, child.stderr),
          child.exitCode.pipe(
            Effect.mapError((cause) =>
              normalizeCliError("claude", operation, cause, "Failed to read Claude CLI exit code"),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );

      if (exitCode !== 0) {
        const stderrDetail = stderr.trim();
        const stdoutDetail = stdout.trim();
        const detail = stderrDetail.length > 0 ? stderrDetail : stdoutDetail;
        return yield* new TextGenerationError({
          operation,
          detail:
            detail.length > 0
              ? `Claude CLI command failed: ${detail}`
              : `Claude CLI command failed with code ${exitCode}.`,
        });
      }

      return stdout;
    });

    const rawStdout = yield* runClaudeCommand().pipe(
      Effect.scoped,
      Effect.timeoutOption(CLAUDE_TIMEOUT_MS),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new TextGenerationError({ operation, detail: "Claude CLI request timed out." }),
            ),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    );

    const envelope = yield* decodeClaudeOutputEnvelope(rawStdout).pipe(
      Effect.catchTags({
        SchemaError: (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Claude CLI returned unexpected output format.",
              cause,
            }),
          ),
      }),
    );

    const decodeOutput = Schema.decodeEffect(outputSchemaJson);
    return yield* decodeOutput(envelope.structured_output).pipe(
      Effect.catchTags({
        SchemaError: (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Claude returned invalid structured output.",
              cause,
            }),
          ),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // TextGeneration service methods
  // ---------------------------------------------------------------------------

  const decideAutoReasoning: TextGeneration.TextGeneration["Service"]["decideAutoReasoning"] =
    Effect.fn("ClaudeTextGeneration.decideAutoReasoning")(function* (input) {
      return yield* Effect.gen(function* () {
        const cwd = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3code-auto-reasoning-claude-cwd-",
        });
        const configDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3code-auto-reasoning-claude-config-",
        });
        const credentialsSource = path.join(claudeConfigDir, ".credentials.json");
        if (yield* fileSystem.exists(credentialsSource).pipe(Effect.orElseSucceed(() => false))) {
          yield* fileSystem.copyFile(credentialsSource, path.join(configDir, ".credentials.json"));
        }
        const { prompt, outputSchema } = buildAutoReasoningPrompt(input);
        const generated = yield* runClaudeJson({
          operation: "decideAutoReasoning",
          cwd,
          prompt,
          outputSchemaJson: outputSchema,
          modelSelection: input.modelSelection,
          environmentOverride: {
            ...claudeEnvironment,
            CLAUDE_CONFIG_DIR: configDir,
            ENABLE_CLAUDEAI_MCP_SERVERS: "false",
          },
        });
        return yield* validateAutoReasoningDecision(input.allowedEfforts, generated);
      }).pipe(
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation: "decideAutoReasoning",
                detail: "Failed to prepare isolated Claude Auto Reasoning.",
                cause,
              }),
        ),
        Effect.scoped,
      );
    });

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("ClaudeTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });

      const generated = yield* runClaudeJson({
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
    Effect.fn("ClaudeTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });

      const generated = yield* runClaudeJson({
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
    Effect.fn("ClaudeTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* runClaudeJson({
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
    Effect.fn("ClaudeTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });

      const generated = yield* runClaudeJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizeThreadTitle(generated.title),
      };
    });

  const generateThreadMetadata: TextGeneration.TextGeneration["Service"]["generateThreadMetadata"] =
    Effect.fn("ClaudeTextGeneration.generateThreadMetadata")(function* (input) {
      const { prompt, outputSchema } = buildThreadMetadataPrompt(input);
      const generated = yield* runClaudeJson({
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
    Effect.fn("ClaudeTextGeneration.translateTranscriptToEnglish")(function* (input) {
      const { prompt, outputSchema } = buildTranscriptTranslationPrompt({ text: input.text });
      const generated = yield* runClaudeJson({
        operation: "translateTranscriptToEnglish",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return { text: generated.text.trim() };
    });

  const improvePrompt: TextGeneration.TextGeneration["Service"]["improvePrompt"] = Effect.fn(
    "ClaudeTextGeneration.improvePrompt",
  )(function* (input) {
    const { prompt, outputSchema } = buildPromptImprovementPrompt({ text: input.text });
    const generated = yield* runClaudeJson({
      operation: "improvePrompt",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return { text: generated.text.trim() };
  });

  const reviewPlanParallelism: TextGeneration.TextGeneration["Service"]["reviewPlanParallelism"] =
    Effect.fn("ClaudeTextGeneration.reviewPlanParallelism")(function* (input) {
      const { prompt, outputSchema } = buildPlanParallelismReviewPrompt(input);
      const generated = yield* runClaudeJson({
        operation: "reviewPlanParallelism",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return { recommendedSubagents: generated.recommendedSubagents };
    });

  const planFetchExploration: TextGeneration.TextGeneration["Service"]["planFetchExploration"] =
    Effect.fn("ClaudeTextGeneration.planFetchExploration")(function* (input) {
      const { prompt, outputSchema } = buildFetchExplorationPrompt(input);
      return yield* runClaudeJson({
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
    enrichKnowledgeGraph: TextGeneration.unsupportedKnowledgeGraphEnrichment("Claude"),
  } satisfies TextGeneration.TextGeneration["Service"];
});
