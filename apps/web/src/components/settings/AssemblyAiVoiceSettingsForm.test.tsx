import { DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS, ProviderInstanceId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
  return { useInterfaceTranslator: () => translator };
});
vi.mock("./settingsLayout", () => ({
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
  }) => (
    <div>
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

describe("AssemblyAI voice settings editing", () => {
  let renderer: ReactTestRenderer | undefined;
  beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(async () => {
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  });

  const field = (label: string) =>
    renderer!.root.findAll(
      (node) => typeof node.type === "string" && node.props["aria-label"] === label,
    )[0]!;
  const submit = () =>
    act(() => renderer!.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
  const mount = async (
    onSave: (settings: typeof DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS) => Promise<boolean>,
  ) => {
    await act(() => {
      renderer = create(
        <AssemblyAiVoiceSettingsForm
          value={DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS}
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

  it("keeps the voice cleanup model choice scoped to this setting", async () => {
    const save = vi.fn().mockResolvedValue(true);
    await mount(save);
    await act(() => renderer!.root.findByProps({ children: "T3 model" }).props.onClick());
    await submit();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        cleanupModelSelection: { instanceId: "codex", model: "gpt-5.6-luna" },
      }),
    );
    await act(() => renderer!.root.findByProps({ children: "AssemblyAI model" }).props.onClick());
    await submit();
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
    await act(() => field("Minimum pause (ms)").props.onChange({ target: { value: "2000" } }));
    await submit();
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      "minimum silence must not exceed maximum silence",
    );
    await act(() => field("Maximum pause (ms)").props.onChange({ target: { value: "2500" } }));
    await act(() =>
      field("Additional recognition context").props.onChange({
        target: { value: "React code review" },
      }),
    );
    await submit();
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
    await submit();
    expect(JSON.stringify(renderer!.toJSON())).toContain("Voice settings saved.");
  });

  it("normalizes language hints and keyterms and exposes only supported controls", async () => {
    const save = vi.fn().mockResolvedValue(true);
    await mount(save);
    await act(() =>
      field("Expected languages").props.onChange({ target: { value: " DE, en, de " } }),
    );
    await act(() =>
      field("Additional terms").props.onChange({
        target: { value: " ChatComposer\nuseAssemblyAiDictation\nChatComposer " },
      }),
    );
    await submit();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        languageCodes: ["de", "en"],
        customKeyterms: ["ChatComposer", "useAssemblyAiDictation"],
      }),
    );
    await act(() =>
      renderer!.root
        .findAllByType("select")
        .find((node) => node.props.value === "universal-3-5-pro")!
        .props.onChange({ target: { value: "universal-streaming-english" } }),
    );
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
    await act(() =>
      field("Additional terms").props.onChange({ target: { value: "x".repeat(51) } }),
    );
    await submit();
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain("Check the values");
  });
});
