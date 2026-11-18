import { AssemblyAiVoiceSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const VOICE_SETTINGS_DEBOUNCE_MS = 600;
const isValidVoiceSettings = Schema.is(AssemblyAiVoiceSettings);

type NumericField = "minTurnSilence" | "maxTurnSilence" | "vadThreshold" | "interruptionDelay";
type TextField = NumericField | "languages" | "terms" | "contextPrompt" | "cleanupInstructions";
type VoiceSettingsDraft = {
  readonly draft: AssemblyAiVoiceSettings;
  readonly languages: string;
  readonly terms: string;
  readonly numbers: Readonly<Record<NumericField, string>>;
  readonly message: "validation" | "saveFailed" | null;
};

export function createVoiceSettingsAutosave(
  value: AssemblyAiVoiceSettings,
  onSave: (settings: AssemblyAiVoiceSettings) => Promise<boolean>,
) {
  let snapshot: VoiceSettingsDraft = {
    draft: value,
    languages: value.languageCodes.join(", "),
    terms: value.customKeyterms.join("\n"),
    numbers: {
      minTurnSilence: String(value.minTurnSilence),
      maxTurnSilence: String(value.maxTurnSilence),
      vadThreshold: String(value.vadThreshold),
      interruptionDelay: String(value.interruptionDelay),
    },
    message: null,
  };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: AssemblyAiVoiceSettings | null = null;
  let saving = false;
  let savingKey: string | null = null;
  let savedKey = JSON.stringify(value);
  let save = onSave;

  function publish(next: VoiceSettingsDraft) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function cancelTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  async function drain() {
    if (saving) return;
    saving = true;
    try {
      while (pending !== null) {
        const next = pending;
        pending = null;
        const key = JSON.stringify(next);
        if (key === savedKey) continue;
        let saved = false;
        savingKey = key;
        try {
          saved = await save(next);
        } catch {
          saved = false;
        } finally {
          savingKey = null;
        }
        if (saved) savedKey = key;
        if (snapshot.message !== "validation" && JSON.stringify(snapshot.draft) === key) {
          publish({ ...snapshot, message: saved ? null : "saveFailed" });
        }
      }
    } finally {
      saving = false;
    }
  }

  function flush() {
    cancelTimer();
    if (snapshot.message === "validation") return;
    pending = JSON.stringify(snapshot.draft) === savingKey ? null : snapshot.draft;
    void drain();
  }

  function change(next: VoiceSettingsDraft, debounced: boolean) {
    cancelTimer();
    pending = null;
    const draft = {
      ...next.draft,
      languageCodes: [
        ...new Set(
          next.languages
            .split(",")
            .map((code) => code.trim().toLowerCase())
            .filter(Boolean),
        ),
      ],
      customKeyterms: [
        ...new Set(
          next.terms
            .split("\n")
            .map((term) => term.trim())
            .filter(Boolean),
        ),
      ],
      minTurnSilence: Number(next.numbers.minTurnSilence),
      maxTurnSilence: Number(next.numbers.maxTurnSilence),
      vadThreshold: Number(next.numbers.vadThreshold.replace(",", ".")),
      interruptionDelay: Number(next.numbers.interruptionDelay),
    };
    const valid =
      Object.values(next.numbers).every((number) => number.trim().length > 0) &&
      isValidVoiceSettings(draft);
    publish({ ...next, draft, message: valid ? null : "validation" });
    if (!valid) return;
    if (debounced) {
      // @effect-diagnostics-next-line globalTimers:off -- UI draft debounce is owned by blur and unmount flushing outside the Effect runtime.
      timer = setTimeout(flush, VOICE_SETTINGS_DEBOUNCE_MS);
    } else flush();
  }

  return {
    setOnSave: (onSave: (settings: AssemblyAiVoiceSettings) => Promise<boolean>) => {
      save = onSave;
    },
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (patch: Partial<AssemblyAiVoiceSettings>) => {
      change({ ...snapshot, draft: { ...snapshot.draft, ...patch } }, false);
    },
    edit: (field: TextField, text: string) => {
      if (field === "languages" || field === "terms") {
        change({ ...snapshot, [field]: text }, true);
      } else if (field === "contextPrompt" || field === "cleanupInstructions") {
        change({ ...snapshot, draft: { ...snapshot.draft, [field]: text } }, true);
      } else {
        change({ ...snapshot, numbers: { ...snapshot.numbers, [field]: text } }, true);
      }
    },
    flush,
  };
}
