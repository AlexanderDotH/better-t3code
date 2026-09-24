import { act, useLayoutEffect, useRef, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { StartAssemblyAiStreamingTranscriptionInput } from "../lib/assemblyAiStreamingTranscription";
import {
  useAssemblyAiDictation,
  type AssemblyAiDictationDraftSnapshot,
} from "./useAssemblyAiDictation";

type HookInput = Parameters<typeof useAssemblyAiDictation>[0];
let renderer: ReactTestRenderer;
let dictation: ReturnType<typeof useAssemblyAiDictation>;
let draft: AssemblyAiDictationDraftSnapshot;
let editDraft: (text: string) => void;
let transportInput: StartAssemblyAiStreamingTranscriptionInput;
const cancelTransport = vi.fn();
const stopTransport = vi.fn(async () => {});
const notice = vi.fn();
const startTransport: NonNullable<HookInput["startTransport"]> = async (input) => {
  transportInput = input;
  return { stop: stopTransport, cancel: cancelTransport };
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function Composer(props: { lifecycleKey?: string; transform?: HookInput["transformTranscript"] }) {
  const [snapshot, setSnapshot] = useState<AssemblyAiDictationDraftSnapshot>({
    text: "Existing requirement.\n",
    cursor: 22,
  });
  const snapshotRef = useRef(snapshot);
  useLayoutEffect(() => {
    snapshotRef.current = snapshot;
  });
  const result = useAssemblyAiDictation({
    configured: true,
    lifecycleKey: props.lifecycleKey ?? "thread-one",
    draftText: snapshot.text,
    getDraftSnapshot: () => snapshotRef.current,
    applyDraftSnapshot: (next) => {
      snapshotRef.current = next;
      setSnapshot(next);
    },
    onNotice: notice,
    startTransport,
    ...(props.transform ? { transformTranscript: props.transform } : {}),
  });
  useLayoutEffect(() => {
    dictation = result;
    draft = snapshot;
    editDraft = (text) => {
      const next = { text, cursor: text.length };
      snapshotRef.current = next;
      setSnapshot(next);
    };
  });
  return null;
}

async function renderComposer(props: Parameters<typeof Composer>[0] = {}) {
  await act(() => {
    renderer = create(<Composer {...props} />);
  });
  await act(() => dictation.start());
}

async function speak(text: string) {
  await act(() => transportInput.onTranscript({ text }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const events = new EventTarget();
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("voice dictation lifecycle", () => {
  it("processes all speech segments once, retains requirements, and restores only the dictation", async () => {
    const transform = vi.fn(async () => ({
      text: "Change [index.ts](apps/web/index.ts), but do not rename the API.",
      references: [
        {
          label: "index.ts",
          previewPath: "apps/web/index.ts",
          candidates: [
            { path: "apps/web/index.ts", symbols: [] },
            { path: "apps/server/index.ts", symbols: [] },
          ],
          truncated: false,
        },
      ],
    }));
    await renderComposer({ transform });
    await speak("Rename the API.");
    expect(draft.text).toBe("Existing requirement.\nRename the API.");
    const original =
      "Rename the API. No, keep the API name. Change index ts. By the way, I need coffee.";
    await speak(original);
    await act(() => dictation.stop());
    expect(transform).toHaveBeenCalledExactlyOnceWith(original);
    expect(draft.text).toBe(
      "Existing requirement.\nChange [index.ts](apps/web/index.ts), but do not rename the API.",
    );
    expect(draft.references?.[0]?.candidates).toHaveLength(2);
    expect(dictation.canRestoreOriginal).toBe(true);
    await act(() => dictation.restoreOriginal());
    expect(draft.text).toBe(`Existing requirement.\n${original}`);
    expect(draft.references).toBeUndefined();
    expect(dictation.canRestoreOriginal).toBe(false);
  });

  it.each(["manual edit", "cancel", "thread switch"])(
    "does not overwrite after %s while processing",
    async (interruption) => {
      const processing = deferred<string>();
      const transform = vi.fn(() => processing.promise);
      await renderComposer({ transform });
      await speak("original speech");
      let stopping: Promise<void>;
      await act(() => {
        stopping = dictation.stop();
      });
      expect(dictation.state).toBe("stopping");
      if (interruption === "manual edit") await act(() => editDraft("My manually edited draft"));
      else if (interruption === "cancel") await act(() => dictation.cancel());
      else
        await act(() =>
          renderer.update(<Composer lifecycleKey="thread-two" transform={transform} />),
        );
      const preserved = draft.text;
      await act(async () => {
        processing.resolve("obsolete cleaned text");
        await stopping!;
      });
      expect(draft.text).toBe(preserved);
      expect(dictation.state).toBe("idle");
      expect(dictation.canRestoreOriginal).toBe(false);
    },
  );

  it("an old finalizer cannot stop a new recording", async () => {
    const processing = deferred<string>();
    await renderComposer({ transform: () => processing.promise });
    await speak("first recording");
    let stopping: Promise<void>;
    await act(() => {
      stopping = dictation.stop();
    });
    await act(() => dictation.cancel());
    await act(() => dictation.start());
    await speak("second recording");
    await act(async () => {
      processing.resolve("old output");
      await stopping!;
    });
    expect(dictation.state).toBe("recording");
    expect(draft.text).toBe("Existing requirement.\nsecond recording");
  });

  it("retains original speech and explains a processing timeout", async () => {
    vi.useFakeTimers();
    await renderComposer({ transform: () => new Promise(() => {}) });
    await speak("Do not delete the tests.");
    let stopping: Promise<void>;
    await act(() => {
      stopping = dictation.stop();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
      await stopping!;
    });
    expect(draft.text).toBe("Existing requirement.\nDo not delete the tests.");
    expect(dictation.active).toBe(false);
    expect(notice.mock.lastCall?.[0].error.message).toContain("timed out");
  });

  it("manual edits while recording preserve the draft and stop late transcript writes", async () => {
    await renderComposer();
    await speak("original speech");
    await act(() => editDraft("Edited by hand"));
    await speak("late transcript");
    expect(draft.text).toBe("Edited by hand");
    expect(dictation.active).toBe(false);
    expect(cancelTransport).toHaveBeenCalled();
  });

  it("does not restore over edits made after processing", async () => {
    await renderComposer({ transform: async () => "cleaned speech" });
    await speak("original speech");
    await act(() => dictation.stop());
    await act(() => editDraft("Edited after cleanup"));
    await act(() => dictation.restoreOriginal());
    expect(draft.text).toBe("Edited after cleanup");
    expect(dictation.canRestoreOriginal).toBe(false);
  });
});
