import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ProjectId } from "./baseSchemas.ts";
import { ServerSettings } from "./settings.ts";
import {
  AssemblyAiVoiceSettings,
  DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
  resolveAssemblyAiVoiceSettings,
  SpeechProcessDictationInput,
} from "./speech.ts";

const decodeSettings = Schema.decodeSync(ServerSettings);
const decodeVoiceSettings = Schema.decodeUnknownSync(AssemblyAiVoiceSettings);
const decodeDictation = Schema.decodeUnknownSync(SpeechProcessDictationInput);

describe("voice contracts", () => {
  it("decodes existing settings while adding conservative defaults", () => {
    const settings = decodeSettings({
      speechTranscription: { assemblyAi: { apiKey: { value: "test-key" } } },
    });
    expect(settings.speechTranscription.assemblyAi.voice).toEqual(
      DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
    );
    expect(settings.speechTranscription.assemblyAi.voice.cleanupMode).toBe("conservative");
    expect(settings.speechTranscription.assemblyAi.voice.cleanupModel).toBe(
      "claude-haiku-4-5-20251001",
    );
    expect(settings.speechTranscription.assemblyAi.voice.cleanupModelSelection).toBeNull();
    expect(settings.speechTranscription.assemblyAi.apiKey.value).toBe("test-key");
  });

  it("keeps a T3 cleanup model selection in voice settings", () => {
    const voice = decodeVoiceSettings({
      cleanupModelSelection: { instanceId: "codex", model: "gpt-5.6-luna" },
    });
    expect(voice.cleanupModelSelection).toEqual({
      instanceId: "codex",
      model: "gpt-5.6-luna",
    });
  });

  it("selects project overrides and inherits the environment otherwise", () => {
    const voice = DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS;
    const override = { ...voice, cleanupMode: "off" as const };
    const settings = { voice, projectOverrides: { selected: override } };
    expect(resolveAssemblyAiVoiceSettings(settings, "selected")).toEqual(override);
    expect(resolveAssemblyAiVoiceSettings(settings, "other")).toEqual(voice);
  });

  it("rejects invalid recording controls and inverted pause thresholds", () => {
    for (const settings of [
      { vadThreshold: 1.1 },
      { vadThreshold: NaN },
      { interruptionDelay: 1_001 },
      { minTurnSilence: 2_000, maxTurnSilence: 100 },
      { speechModel: "invented-model" },
      { languageCodes: ["de-DE"] },
    ]) {
      expect(() => decodeVoiceSettings(settings)).toThrow();
    }
  });

  it("bounds the complete dictation and accepts an optional thread", () => {
    const input = {
      projectId: ProjectId.make("voice-project"),
      transcript: "Do not change the API. Actually, update only the implementation.",
    };
    expect(decodeDictation(input)).toEqual(input);
    expect(() =>
      decodeDictation({
        ...input,
        transcript: "a".repeat(16_001),
      }),
    ).toThrow();
  });
});
