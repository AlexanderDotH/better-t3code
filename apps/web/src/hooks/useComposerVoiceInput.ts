import { useAtomValue } from "@effect/atom-react";
import {
  resolveBetterT3FeatureFlag,
  type EnvironmentId,
  type ProjectId,
  type SpeechProcessDictationResult,
  type ThreadId,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { translateVoiceDictationResult } from "@t3tools/shared/voiceFileContext";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { resolveAssemblyAiVoiceInputAvailability } from "../components/chat/voiceInputAvailability";
import { toastManager } from "../components/ui/toast";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  useAssemblyAiDictation,
  type AssemblyAiDictationDraftSnapshot,
} from "./useAssemblyAiDictation";

export function useComposerVoiceInput(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly threadId: ThreadId | null;
  readonly draftTarget: ScopedThreadRef | DraftId;
  readonly settings: UnifiedSettings;
  readonly draftText: string;
  readonly readSnapshot: () => Pick<AssemblyAiDictationDraftSnapshot, "text" | "cursor">;
  readonly applySnapshot: (
    snapshot: Pick<AssemblyAiDictationDraftSnapshot, "text" | "cursor">,
  ) => void;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(input.environmentId));
  const apiKey = input.settings.speechTranscription.assemblyAi.apiKey;
  const configured = resolveAssemblyAiVoiceInputAvailability({
    featureEnabled: resolveBetterT3FeatureFlag(
      input.settings.betterT3Environment,
      "voice.assemblyAi",
    ),
    environmentSettingsVersion: config?.environment.capabilities.environmentSettingsVersion,
    apiKeyConfigured: apiKey.value.trim().length > 0 || apiKey.valueRedacted === true,
  }).configured;
  const createToken = useAtomCommand(serverEnvironment.createAssemblyAiStreamingToken, {
    reportFailure: false,
  });
  const processDictation = useAtomCommand(serverEnvironment.processSpeechDictation, {
    reportFailure: false,
  });
  const translateTranscript = useAtomCommand(serverEnvironment.translateSpeechTranscript, {
    reportFailure: false,
  });
  const supportsProcessing =
    config?.environment.capabilities.supportsSpeechDictationProcessing === true;
  const context = () => {
    if (input.projectId === null)
      throw new Error("Project context is unavailable for voice input.");
    return {
      projectId: input.projectId,
      ...(input.threadId === null ? {} : { threadId: input.threadId }),
    };
  };
  const dictation = useAssemblyAiDictation({
    configured,
    draftText: input.draftText,
    lifecycleKey:
      typeof input.draftTarget === "string"
        ? `draft:${input.draftTarget}`
        : `thread:${input.draftTarget.environmentId}:${input.draftTarget.threadId}`,
    getDraftSnapshot: () => ({
      ...input.readSnapshot(),
      references:
        useComposerDraftStore.getState().getComposerDraft(input.draftTarget)?.voiceFileReferences ??
        [],
    }),
    applyDraftSnapshot: (snapshot) => {
      input.applySnapshot(snapshot);
      useComposerDraftStore
        .getState()
        .setVoiceFileReferences(input.draftTarget, snapshot.references ?? []);
    },
    onNotice: ({ title, error }) =>
      toastManager.add({
        type: "error",
        title,
        description: error.message,
        ...(title === "Could not process voice input" || title === "Voice input"
          ? { timeout: 0 }
          : {}),
      }),
    createToken: async () => {
      const target = context();
      const result = await createToken({
        environmentId: input.environmentId,
        input: supportsProcessing ? target : { projectId: target.projectId },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    },
    transformTranscript: async (transcript) => {
      const target = context();
      let processed: SpeechProcessDictationResult = { text: transcript, references: [] };
      if (supportsProcessing) {
        const result = await processDictation({
          environmentId: input.environmentId,
          input: { ...target, transcript },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        processed = result.value;
      }
      if (input.settings.voiceInputOutputLanguage !== "english" || processed.warning)
        return processed;
      try {
        return await translateVoiceDictationResult(processed, async (text) => {
          const result = await translateTranscript({
            environmentId: input.environmentId,
            input: { projectId: target.projectId, text },
          });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          return result.value.text;
        });
      } catch {
        return {
          ...processed,
          warning: "Could not translate voice input. The original language was kept.",
        };
      }
    },
  });
  return {
    ...dictation,
    configured,
    visible: configured || dictation.active || dictation.canRestoreOriginal,
  };
}
