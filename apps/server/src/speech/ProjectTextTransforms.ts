import {
  type ImprovePromptInput,
  type ProjectId,
  ProjectTextTransformError,
  type ProjectTextTransformResult,
  type TranslateTranscriptInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

type ProjectTextTransformInput = TranslateTranscriptInput | ImprovePromptInput;
type ProjectTextTransformOperation = ProjectTextTransformError["operation"];
type GenerateText = TextGeneration.TextGeneration["Service"]["translateTranscriptToEnglish"];

export class ProjectTextTransforms extends Context.Service<
  ProjectTextTransforms,
  {
    readonly translateTranscript: (
      input: TranslateTranscriptInput,
    ) => Effect.Effect<ProjectTextTransformResult, ProjectTextTransformError>;
    readonly improvePrompt: (
      input: ImprovePromptInput,
    ) => Effect.Effect<ProjectTextTransformResult, ProjectTextTransformError>;
  }
>()("t3/speech/ProjectTextTransforms") {}

function transformError(
  operation: ProjectTextTransformOperation,
  projectId: ProjectId,
  reason: string,
): ProjectTextTransformError {
  return new ProjectTextTransformError({ operation, projectId, reason });
}

export const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;

  const transform = Effect.fn("ProjectTextTransforms.transform")(function* (
    operation: ProjectTextTransformOperation,
    input: ProjectTextTransformInput,
    generate: GenerateText,
  ) {
    const project = yield* projectionSnapshotQuery
      .getProjectShellById(input.projectId)
      .pipe(
        Effect.mapError(() =>
          transformError(operation, input.projectId, "The project could not be resolved."),
        ),
      );
    if (Option.isNone(project)) {
      return yield* transformError(operation, input.projectId, "The project was not found.");
    }

    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(() =>
        transformError(operation, input.projectId, "Server settings could not be loaded."),
      ),
    );
    const generated = yield* generate({
      cwd: project.value.workspaceRoot,
      text: input.text,
      modelSelection: settings.textGenerationModelSelection,
    }).pipe(
      Effect.mapError(() => transformError(operation, input.projectId, "Text generation failed.")),
    );
    const text = generated.text.trim();
    if (text.length === 0) {
      return yield* transformError(
        operation,
        input.projectId,
        "Text generation returned empty text.",
      );
    }

    return { text } satisfies ProjectTextTransformResult;
  });

  const translateTranscript: ProjectTextTransforms["Service"]["translateTranscript"] = Effect.fn(
    "ProjectTextTransforms.translateTranscript",
  )(function* (input) {
    return yield* transform(
      "translate-transcript",
      input,
      textGeneration.translateTranscriptToEnglish,
    );
  });

  const improvePrompt: ProjectTextTransforms["Service"]["improvePrompt"] = Effect.fn(
    "ProjectTextTransforms.improvePrompt",
  )(function* (input) {
    return yield* transform("improve-prompt", input, textGeneration.improvePrompt);
  });

  return ProjectTextTransforms.of({ translateTranscript, improvePrompt });
});

export const layer = Layer.effect(ProjectTextTransforms, make);
