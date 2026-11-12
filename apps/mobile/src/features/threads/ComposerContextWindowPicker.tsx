import type { ModelSelection, ProviderDriverKind } from "@t3tools/contracts";
import {
  CODEX_CONTEXT_WINDOW_OPTION_ID,
  getProviderOptionCurrentValue,
} from "@t3tools/shared/model";
import type { ModelOption } from "../../lib/modelOptions";
import {
  applyProviderOptionSelection,
  resolveProviderOptionDescriptors,
} from "../../lib/providerOptions";
import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { Menu } from "../../components/ui/Menu";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { updateComposerDraftSettings } from "../../state/use-composer-drafts";

export function ComposerContextWindowPicker(props: {
  readonly draftKey: string;
  readonly selection: ModelSelection;
  readonly modelOption: ModelOption | null;
  readonly provider: ProviderDriverKind | undefined;
  readonly disabled: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const descriptors = resolveProviderOptionDescriptors({
    capabilities: props.modelOption?.capabilities,
    selections: props.selection.options,
  });
  const descriptor = descriptors.find(
    (entry) => entry.id === CODEX_CONTEXT_WINDOW_OPTION_ID && entry.type === "select",
  );
  if (props.provider !== "codex" || descriptor?.type !== "select" || !descriptor.options.length)
    return null;
  const current = getProviderOptionCurrentValue(descriptor);
  const label =
    descriptor.options.find((option) => option.id === current)?.label ??
    descriptor.options[0]!.label;
  return (
    <Menu
      title={translator.message("chat.contextWindow.size")}
      actions={descriptor.options.map((option) => ({
        id: option.id,
        title: option.label,
        state: option.id === current ? "on" : "off",
        attributes: { disabled: props.disabled },
      }))}
      onPressAction={({ nativeEvent }) => {
        if (props.disabled) return;
        const options = applyProviderOptionSelection(descriptors, {
          id: descriptor.id,
          value: nativeEvent.event,
        });
        if (options)
          updateComposerDraftSettings(props.draftKey, {
            modelSelection: { ...props.selection, options },
          });
      }}
    >
      <ComposerInlineControl
        label={label}
        accessibilityLabel={`${translator.message("chat.contextWindow.size")}: ${label}`}
        icon="chart.bar.xaxis"
        disabled={props.disabled}
        onPress={() => {}}
      />
    </Menu>
  );
}
