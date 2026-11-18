import { installMemoryStorage } from "../../../test/memoryStorage";
import { DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS, ProviderInstanceId } from "@t3tools/contracts";
import { type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
  return { useInterfaceTranslator: () => translator };
});
vi.mock("./settingsLayout", () => ({
  useSettingsSearchTargetId: () => null,
  SettingsRow: ({
    title,
    description,
    control,
    children,
  }: {
    title: ReactNode;
    description?: ReactNode;
    control?: ReactNode;
    children?: ReactNode;
  }) => (
    <div>
      {title}
      {description}
      {control}
      {children}
    </div>
  ),
}));
vi.mock("../ui/input", () => ({
  Input: ({ nativeInput: _nativeInput, ...props }: Record<string, unknown>) => <input {...props} />,
}));
vi.mock("../ui/textarea", () => ({
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}));
vi.mock("../ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));
vi.mock("../ui/button", () => ({
  Button: (props: Record<string, unknown>) => <button {...props} />,
}));
vi.mock("../ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    disabled?: boolean;
    children?: ReactNode;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),

  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectPopup: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("../chat/ProviderModelPicker", () => ({
  ProviderModelPicker: (props: {
    onInstanceModelChange: (
      instanceId: ReturnType<typeof ProviderInstanceId.make>,
      model: string,
    ) => void;
    onAuxiliaryModelChange: (model: string) => void;
    triggerAriaLabel: string;
  }) => (
    <div aria-label={props.triggerAriaLabel}>
      <button
        type="button"
        onClick={() =>
          props.onInstanceModelChange(ProviderInstanceId.make("codex"), "gpt-5.6-luna")
        }
      >
        T3 model
      </button>
      <button
        type="button"
        onClick={() => props.onAuxiliaryModelChange("claude-haiku-4-5-20251001")}
      >
        AssemblyAI model
      </button>
    </div>
  ),
}));

import { AssemblyAiVoiceSettingsForm } from "./AssemblyAiVoiceSettingsForm";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("AssemblyAI voice settings editing", () => {
  beforeEach(() => {
    installMemoryStorage();
    vi.useFakeTimers();
  });
  let renderer: ReactTestRenderer | undefined;

  afterEach(async () => {
    await act(async () => {
      await renderer?.unmount();
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const field = (label: string) =>
    renderer!.root.findAll(
      (node) => typeof node.type === "string" && node.props["aria-label"] === label,
    )[0]!;
  const flush = () =>
    act(async () => {
      await field("Expected languages").props.onBlur();
    });
  const advance = (milliseconds = 600) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  const mount = async (
    onSave: (settings: typeof DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS) => Promise<boolean>,
    value = DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
  ) => {
    await act(() => {
      renderer = create(
        <AssemblyAiVoiceSettingsForm
          value={value}
          models={[{ id: "claude-haiku-4-5-20251001", name: "Haiku 4.5" }]}
          t3Models={{
            fallbackSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.6-luna",
            },
            instanceEntries: [],
            optionsByInstance: new Map(),
          }}
          disabled={false}
          onSave={onSave}
        />,
      );
    });
  };

  it("saves the complete voice draft", async () => {
    const save = vi.fn().mockResolvedValue(true);
    await mount(save, { ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS, cleanupMode: "custom" });
    const instructions = renderer!.root
      .findAllByType("textarea")
      .find((node) => node.props.maxLength === 4000)!;
    await act(async () => {
      await instructions.props.onChange({ target: { value: "Keep project names intact" } });
    });
    await act(async () => {
      await field("Minimum pause (ms)").props.onChange({ target: { value: "500" } });
    });
    await act(async () => {
      await field("Advanced mode").props.onChange({ target: { checked: true } });
    });
    const interpretationPicker = renderer!.root.findAll(
      (node) => node.type === "div" && node.props["aria-label"] === "Interpretation model",
    )[0]!;
    await act(async () => {
      await interpretationPicker.findAllByType("button")[0]!.props.onClick();
    });
    await flush();
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cleanupMode: "custom",
        cleanupInstructions: "Keep project names intact",
        minTurnSilence: 500,
        advancedMode: true,
        interpretationModelSelection: { instanceId: "codex", model: "gpt-5.6-luna" },
        cleanupModelSelection: null,
      }),
    );
  });

  it("reports invalid cleanup details instead of saving", async () => {
    const save = vi.fn().mockResolvedValue(true);
    await mount(save, { ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS, cleanupMode: "custom" });
    await act(async () => {
      await renderer!.root
        .findAllByType("textarea")
        .find((node) => node.props.maxLength === 4000)!
        .props.onChange({ target: { value: "x".repeat(4001) } });
    });
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain("Check the values");
  });

  it("keeps the voice cleanup model choice scoped to this setting", async () => {
    const save = vi.fn().mockResolvedValue(true);
    await mount(save);
    await act(async () => {
      await renderer!.root.findByProps({ children: "T3 model" }).props.onClick();
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupModelSelection: { instanceId: "codex", model: "gpt-5.6-luna" },
      }),
    );
    await act(async () => {
      await renderer!.root.findByProps({ children: "AssemblyAI model" }).props.onClick();
    });
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cleanupModelSelection: null,
        cleanupModel: "claude-haiku-4-5-20251001",
      }),
    );
  });

  it("blocks conflicting pauses and keeps edits available after a failed save", async () => {
    const save = vi.fn().mockResolvedValue(false);
    await mount(save);
    await act(async () => {
      await field("Minimum pause (ms)").props.onChange({ target: { value: "2000" } });
    });
    await act(async () => {
      await field("Advanced mode").props.onChange({ target: { checked: true } });
    });
    await advance();
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      "minimum silence must not exceed maximum silence",
    );
    await act(async () => {
      await field("Maximum pause (ms)").props.onChange({ target: { value: "2500" } });
    });
    await act(async () => {
      await field("Additional recognition context").props.onChange({
        target: { value: "React code review" },
      });
    });
    await flush();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        minTurnSilence: 2000,
        maxTurnSilence: 2500,
        contextPrompt: "React code review",
      }),
    );
    expect(JSON.stringify(renderer!.toJSON())).toContain("Your changes are still here");
    expect(field("Additional recognition context").props.value).toBe("React code review");
    save.mockResolvedValue(true);
    await act(async () => {
      await field("Additional recognition context").props.onChange({
        target: { value: "React code review updated" },
      });
    });
    await advance();
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ contextPrompt: "React code review updated" }),
    );
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Your changes are still here");
  });

  it("normalizes language hints and keyterms and exposes only supported controls", async () => {
    const save = vi.fn().mockResolvedValue(true);
    await mount(save);
    await act(async () => {
      await field("Expected languages").props.onChange({ target: { value: " DE, en, de " } });
    });
    await act(async () => {
      await field("Additional terms").props.onChange({
        target: { value: " ChatComposer\nuseAssemblyAiDictation\nChatComposer " },
      });
    });
    await flush();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        languageCodes: ["de", "en"],
        customKeyterms: ["ChatComposer", "useAssemblyAiDictation"],
      }),
    );
    await act(async () => {
      await renderer!.root
        .findAllByType("select")
        .find((node) => node.props.value === "universal-3-5-pro")!
        .props.onChange({ target: { value: "universal-streaming-english" } });
    });
    expect(field("Expected languages").props.disabled).toBe(true);
    expect(
      renderer!.root.findAllByType("select").find((node) => node.props.value === "balanced")!.props
        .disabled,
    ).toBe(true);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Additional recognition context");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("First interim result delay");
  });

  it("rejects overlong keyterms before sending settings", async () => {
    const save = vi.fn().mockResolvedValue(true);
    await mount(save);
    await act(async () => {
      await field("Additional terms").props.onChange({ target: { value: "x".repeat(51) } });
    });
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain("Check the values");
  });

  it("debounces typing and flushes on blur without saving the same value twice", async () => {
    const save = vi.fn().mockResolvedValue(true);
    await mount(save);
    await act(async () => {
      field("Additional recognition context").props.onChange({ target: { value: "First" } });
    });
    await advance(400);
    await act(async () => {
      field("Additional recognition context").props.onChange({ target: { value: "Latest" } });
    });
    await advance(599);
    expect(save).not.toHaveBeenCalled();
    await advance(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ contextPrompt: "Latest" }),
    );
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      field("Additional recognition context").props.onChange({ target: { value: "On blur" } });
      field("Additional recognition context").props.onBlur();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ contextPrompt: "On blur" }));
    await advance();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("serializes saves, replaces queued edits, and preserves typing across saved value updates", async () => {
    const first = deferred<boolean>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
    await mount(save);
    await act(async () => {
      field("Advanced mode").props.onChange({ target: { checked: true } });
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      field("Additional recognition context").props.onChange({ target: { value: "Queued" } });
    });
    await advance();
    await act(async () => {
      field("Additional recognition context").props.onChange({ target: { value: "Still typing" } });
      renderer!.update(
        <AssemblyAiVoiceSettingsForm
          value={save.mock.calls[0]![0]}
          models={[]}
          t3Models={{
            fallbackSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.6-luna",
            },
            instanceEntries: [],
            optionsByInstance: new Map(),
          }}
          disabled={false}
          onSave={save}
        />,
      );
      first.resolve(true);
    });
    expect(field("Additional recognition context").props.value).toBe("Still typing");
    expect(save).toHaveBeenCalledTimes(1);
    await advance();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ advancedMode: true, contextPrompt: "Still typing" }),
    );
  });

  it("cancels queued saves while a language is invalid and resumes with the complete valid draft", async () => {
    const first = deferred<boolean>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
    await mount(save);
    await act(async () => {
      field("Advanced mode").props.onChange({ target: { checked: true } });
      field("Additional terms").props.onChange({ target: { value: "ChatComposer" } });
    });
    await advance();
    await act(async () => {
      field("Expected languages").props.onChange({ target: { value: "invalid" } });
      first.resolve(true);
    });
    await advance();
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer!.toJSON())).toContain("Check the values");
    expect(field("Expected languages").props.value).toBe("invalid");
    await act(async () => {
      field("Expected languages").props.onChange({ target: { value: "de" } });
    });
    await advance();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ languageCodes: ["de"], customKeyterms: ["ChatComposer"] }),
    );
  });

  it("keeps a rejected save editable and retries on the next immediate change", async () => {
    const first = deferred<boolean>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(true);
    await mount(save);
    await act(async () => {
      field("Additional recognition context").props.onChange({ target: { value: "Keep this" } });
    });
    await advance();
    await act(async () => {
      field("Additional recognition context").props.onBlur();
      field("Additional recognition context").props.onBlur();
      first.reject(new Error("offline"));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer!.toJSON())).toContain("Your changes are still here");
    expect(field("Additional recognition context").props.disabled).toBe(false);
    expect(field("Additional recognition context").props.value).toBe("Keep this");
    await act(async () => {
      field("Advanced mode").props.onChange({ target: { checked: true } });
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ contextPrompt: "Keep this", advancedMode: true }),
    );
  });

  it("flushes pending typing when leaving the settings", async () => {
    const save = vi.fn().mockResolvedValue(true);
    await mount(save);
    await act(async () => {
      field("Additional recognition context").props.onChange({
        target: { value: "Before leaving" },
      });
    });
    await act(async () => {
      renderer!.unmount();
      renderer = undefined;
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ contextPrompt: "Before leaving" }),
    );
  });
});
