import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TextGenerationError,
  type ModelSelection,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectTextTransforms from "./ProjectTextTransforms.ts";

const projectId = ProjectId.make("project-text-transforms");
const project: OrchestrationProjectShell = {
  id: projectId,
  title: "Text transforms",
  workspaceRoot: "/trusted/project-root",
  defaultModelSelection: null,
  checkpointsEnabled: true,
  scripts: [],
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
};
const modelSelection = createModelSelection(
  ProviderInstanceId.make("claude-work"),
  "claude-sonnet-4-6",
  [{ id: "effort", value: "high" }],
);
const voiceTranslationModelSelection = createModelSelection(
  ProviderInstanceId.make("codex-voice"),
  "gpt-5.6-luna",
  [{ id: "reasoningEffort", value: "low" }],
);

function projectionLayer(projectResult: Option.Option<OrchestrationProjectShell>) {
  return Layer.mock(ProjectionSnapshotQuery, {
    getProjectShellById: () => Effect.succeed(projectResult),
  });
}

function textGenerationLayer(overrides: Partial<TextGeneration.TextGeneration["Service"]>) {
  return Layer.mock(TextGeneration.TextGeneration, overrides);
}

function serviceLayer(input: {
  readonly project?: Option.Option<OrchestrationProjectShell>;
  readonly modelSelection?: ModelSelection;
  readonly voiceTranslationModelSelection?: ModelSelection | null;
  readonly textGeneration: Partial<TextGeneration.TextGeneration["Service"]>;
}) {
  const selectedModel = input.modelSelection ?? modelSelection;
  const voiceModel = input.voiceTranslationModelSelection ?? null;
  return ProjectTextTransforms.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        projectionLayer(input.project ?? Option.some(project)),
        ServerSettingsService.layerTest({
          providerInstances: {
            [selectedModel.instanceId]: {
              driver: ProviderDriverKind.make("claudeAgent"),
              enabled: true,
              config: {},
            },
            ...(voiceModel
              ? {
                  [voiceModel.instanceId]: {
                    driver: ProviderDriverKind.make("codex"),
                    enabled: true,
                    config: {},
                  },
                }
              : {}),
          },
          textGenerationModelSelection: selectedModel,
          voiceTranslationModelSelection: voiceModel,
        }),
        textGenerationLayer(input.textGeneration),
      ),
    ),
  );
}

describe("ProjectTextTransforms", () => {
  it.effect("uses the voice override only for transcript translation", () => {
    const translateCalls: Array<TextGeneration.TranscriptTranslationInput> = [];
    const improveCalls: Array<TextGeneration.PromptImprovementInput> = [];
    const layer = serviceLayer({
      voiceTranslationModelSelection,
      textGeneration: {
        translateTranscriptToEnglish: (input) => {
          translateCalls.push(input);
          return Effect.succeed({ text: "  Update the reconnect logic.  " });
        },
        improvePrompt: (input) => {
          improveCalls.push(input);
          return Effect.succeed({ text: "\nClarify the retry requirements.\t" });
        },
      },
    });

    return Effect.gen(function* () {
      const transforms = yield* ProjectTextTransforms.ProjectTextTransforms;
      const translated = yield* transforms.translateTranscript({
        projectId,
        text: "Actualiza la lógica de reconexión.",
      });
      const improved = yield* transforms.improvePrompt({
        projectId,
        text: "Clarify retries.",
      });

      expect(translated).toEqual({ text: "Update the reconnect logic." });
      expect(improved).toEqual({ text: "Clarify the retry requirements." });
      expect(translateCalls).toEqual([
        {
          cwd: project.workspaceRoot,
          text: "Actualiza la lógica de reconexión.",
          modelSelection: voiceTranslationModelSelection,
        },
      ]);
      expect(improveCalls).toEqual([
        {
          cwd: project.workspaceRoot,
          text: "Clarify retries.",
          modelSelection,
        },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("returns a typed error when the project does not exist", () => {
    const inputText = "do not include this prompt";
    const layer = serviceLayer({
      project: Option.none(),
      textGeneration: {},
    });

    return Effect.gen(function* () {
      const transforms = yield* ProjectTextTransforms.ProjectTextTransforms;
      const error = yield* transforms
        .translateTranscript({ projectId, text: inputText })
        .pipe(Effect.flip);

      expect(error._tag).toBe("ProjectTextTransformError");
      expect(error.operation).toBe("translate-transcript");
      expect(error.projectId).toBe(projectId);
      expect(error.reason).toBe("The project was not found.");
      expect(
        yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(error),
      ).not.toContain(inputText);
    }).pipe(Effect.provide(layer));
  });

  it.effect("maps provider failures without leaking prompt contents", () => {
    const inputText = "private prompt contents";
    const layer = serviceLayer({
      textGeneration: {
        improvePrompt: (input) =>
          Effect.fail(
            new TextGenerationError({
              operation: "improvePrompt",
              detail: `Provider rejected: ${input.text}`,
            }),
          ),
      },
    });

    return Effect.gen(function* () {
      const transforms = yield* ProjectTextTransforms.ProjectTextTransforms;
      const error = yield* transforms
        .improvePrompt({ projectId, text: inputText })
        .pipe(Effect.flip);

      expect(error._tag).toBe("ProjectTextTransformError");
      expect(error.operation).toBe("improve-prompt");
      expect(error.reason).toBe("Text generation failed.");
      expect(error.cause).toBeUndefined();
      expect(
        yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(error),
      ).not.toContain(inputText);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects empty generated text with a typed error", () => {
    const layer = serviceLayer({
      textGeneration: {
        translateTranscriptToEnglish: () => Effect.succeed({ text: " \n\t " }),
      },
    });

    return Effect.gen(function* () {
      const transforms = yield* ProjectTextTransforms.ProjectTextTransforms;
      const error = yield* transforms
        .translateTranscript({ projectId, text: "Translate this." })
        .pipe(Effect.flip);

      expect(error._tag).toBe("ProjectTextTransformError");
      expect(error.operation).toBe("translate-transcript");
      expect(error.reason).toBe("Text generation returned empty text.");
    }).pipe(Effect.provide(layer));
  });
});
