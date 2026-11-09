import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

const { setProviderModelOptions } = vi.hoisted(() => ({ setProviderModelOptions: vi.fn() }));

vi.mock("../../composerDraftStore", () => ({
  DraftId: { make: (value: string) => value },
  useComposerDraftStore: (
    selector: (store: { setProviderModelOptions: typeof setProviderModelOptions }) => unknown,
  ) => selector({ setProviderModelOptions }),
}));

vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));

vi.mock("../ui/menu", () => ({
  MenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MenuRadioGroup: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  ),
  MenuRadioItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  MenuSeparator: () => <hr />,
}));

import { DraftId } from "../../composerDraftStore";
import { ContextWindowMenuContent } from "./ContextWindowPicker";
import { TraitsMenuContent } from "./TraitsPicker";

const models: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "auto-test",
    name: "Auto test",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          currentValue: "high",
          options: [
            { id: "high", label: "High" },
            { id: "low", label: "Low" },
          ],
        },
        {
          id: "contextWindow",
          label: "Context",
          type: "select",
          currentValue: "200k",
          options: [
            { id: "200k", label: "200k" },
            { id: "1m", label: "1M" },
          ],
        },
        { id: "fastMode", label: "Fast", type: "boolean", currentValue: false },
      ],
    },
  },
];
const autoOptions: ReadonlyArray<ProviderOptionSelection> = [
  { id: "reasoningEffort", value: "high" },
  { id: "contextWindow", value: "200k" },
  { id: "t3AutoReasoning", value: true },
];
const input = {
  provider: ProviderDriverKind.make("codex"),
  models,
  model: "auto-test",
  modelOptions: autoOptions,
};

describe("Auto reasoning controls", () => {
  it("keeps Auto when editing native context and speed, and disables it for a manual effort", async () => {
    setProviderModelOptions.mockClear();
    const onModelOptionsChange = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <TraitsMenuContent
            {...input}
            planModeEnabled
            onModelOptionsChange={onModelOptionsChange}
          />,
        );
      });
      const [reasoning, context, speed] = renderer!.root.findAllByType("select");
      expect(reasoning!.props.value).toBe("t3AutoReasoning");
      for (const [control, value] of [
        [context!, "1m"],
        [speed!, "on"],
      ] as const) {
        await act(() => control.props.onChange({ currentTarget: { value } }));
        expect(onModelOptionsChange.mock.lastCall?.[0]).toContainEqual({
          id: "t3AutoReasoning",
          value: true,
        });
      }
      await act(() => reasoning!.props.onChange({ currentTarget: { value: "low" } }));
      expect(onModelOptionsChange.mock.lastCall?.[0]).not.toContainEqual({
        id: "t3AutoReasoning",
        value: true,
      });
      expect(onModelOptionsChange.mock.lastCall?.[0]).toContainEqual({
        id: "reasoningEffort",
        value: "low",
      });
    } finally {
      await act(async () => renderer?.unmount());
    }
  });

  it("keeps Auto when changing the Better context window slider", async () => {
    setProviderModelOptions.mockClear();
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(
          <ContextWindowMenuContent
            {...input}
            instanceId={ProviderInstanceId.make("codex-work")}
            draftId={DraftId.make("auto-test")}
          />,
        );
      });
      await act(() =>
        renderer!.root
          .findByType("input")
          .props.onChange({ currentTarget: { value: "1" }, stopPropagation() {} }),
      );
      expect(setProviderModelOptions.mock.lastCall?.[2]).toContainEqual({
        id: "contextWindow",
        value: "1m",
      });
      expect(setProviderModelOptions.mock.lastCall?.[2]).toContainEqual({
        id: "t3AutoReasoning",
        value: true,
      });
      await act(() =>
        renderer!.update(
          <ContextWindowMenuContent
            {...input}
            instanceId={ProviderInstanceId.make("codex-personal")}
            draftId={DraftId.make("auto-test")}
          />,
        ),
      );
      expect(renderer!.root.findByType("input").props.value).toBe(0);
    } finally {
      await act(async () => renderer?.unmount());
    }
  });
});
