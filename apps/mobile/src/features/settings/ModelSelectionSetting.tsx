import type {
  ModelSelection,
  ModelSelectionPurpose,
  ProjectId,
  ServerConfig,
} from "@t3tools/contracts";
import { useState } from "react";

import { ModelSelectionModal, modelSelectionLabel } from "./ModelSelectionModal";
import { SettingsRow } from "./components/SettingsRow";
import type { ModelOption } from "../../lib/modelOptions";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ModelSelectionSetting(props: {
  readonly config: ServerConfig;
  readonly icon: "sparkles" | "arrow.triangle.branch" | "mic" | "text.bubble";
  readonly label: string;
  readonly selection: ModelSelection | null;
  readonly purpose: ModelSelectionPurpose;
  readonly allowDefault?: boolean;
  readonly disabled?: boolean;
  readonly projectId?: ProjectId | null;
  readonly optionPredicate?: (option: ModelOption) => boolean;
  readonly defaultLabel?: string;
  readonly onSelect: (selection: ModelSelection | null) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingsRow
        disabled={props.disabled}
        icon={props.icon}
        label={props.label}
        value={
          props.selection === null
            ? (props.defaultLabel ?? translator.message("mobile.settings.agents.defaultTextModel"))
            : modelSelectionLabel(props.config, props.selection)
        }
        onPress={() => setOpen(true)}
      />
      <ModelSelectionModal
        config={props.config}
        current={props.selection}
        allowDefault={props.allowDefault}
        defaultLabel={props.defaultLabel}
        purpose={props.purpose}
        visible={open}
        disabled={props.disabled}
        projectId={props.projectId}
        optionPredicate={props.optionPredicate}
        onClose={() => setOpen(false)}
        onSelect={props.onSelect}
      />
    </>
  );
}
