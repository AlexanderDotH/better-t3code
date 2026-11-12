import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  repositoryGroupingKeyOf,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { isAttachmentOnlyBootstrapPrompt } from "@t3tools/shared/composerContextReferences";
import {
  buildNewThreadLink,
  parsePromptLinkRepository,
  PROMPT_LINK_MAX_PROMPT_LENGTH,
} from "@t3tools/shared/promptLinks";

export function palettePromptLink(input: {
  readonly prompt: string;
  readonly project: EnvironmentProject | null | undefined;
  readonly modelSelection: ModelSelection | null | undefined;
  readonly providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver">>;
  readonly withContext: boolean;
}) {
  const prompt = input.prompt.trim();
  if (
    !prompt ||
    prompt.length > PROMPT_LINK_MAX_PROMPT_LENGTH ||
    isAttachmentOnlyBootstrapPrompt(prompt)
  )
    return null;
  if (!input.withContext) return buildNewThreadLink({ prompt });
  const key = input.project?.repositoryIdentity
    ? repositoryGroupingKeyOf(input.project.repositoryIdentity)
    : null;
  const repository = key?.startsWith("github.com/")
    ? parsePromptLinkRepository(key.slice("github.com/".length))
    : null;
  if (repository === null) return null;
  const provider =
    input.providers.find((candidate) => candidate.instanceId === input.modelSelection?.instanceId)
      ?.driver ?? null;
  return buildNewThreadLink({
    prompt,
    repository,
    provider,
    model: provider ? input.modelSelection?.model : null,
  });
}
