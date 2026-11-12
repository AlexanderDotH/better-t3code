import { supportsAutoReasoningEvaluationProvider } from "@t3tools/client-runtime/provider-selection";
import { isFetchCapableProvider } from "@t3tools/shared/fetchMode";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectId, ServerConfig, ServerSettingsPatch } from "@t3tools/contracts";
import { isManagedSettingPath } from "@t3tools/contracts";
import { useState } from "react";

import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { AgentSettingsSheet } from "./AgentSettingsSheet";
import { ModelSelectionSetting } from "./ModelSelectionSetting";
import { SettingsRow } from "./components/SettingsRow";
import { textGenerationModelSettingsPatch } from "./mobile-model-settings";

export function MobileAgentModelSettings(props: {
  readonly config: ServerConfig;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly disabled: boolean;
  readonly updateSettings: (patch: ServerSettingsPatch, label: string) => Promise<boolean>;
}) {
  const translator = useMobileInterfaceTranslator();
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const project = props.projects.find((candidate) => candidate.id === projectId);
  const selectedProjectId = project?.id ?? null;
  const settings = props.config.settings;
  const disabledFor = (key: string) =>
    props.disabled || isManagedSettingPath(props.config.managedPolicy, key);
  const textSelection =
    selectedProjectId === null
      ? settings.textGenerationModelSelection
      : (settings.projectSettingsOverrides[selectedProjectId]?.textGenerationModelSelection ??
        null);
  return (
    <>
      <ModelSelectionSetting
        config={props.config}
        icon="sparkles"
        label={translator.message("mobile.agents.defaultModel")}
        purpose="agent"
        selection={settings.defaultModelSelection}
        defaultLabel={translator.message("mobile.settings.agents.automatic")}
        disabled={disabledFor("defaultModelSelection")}
        onSelect={(selection) =>
          void props.updateSettings(
            { defaultModelSelection: selection },
            translator.message("mobile.agents.defaultModel"),
          )
        }
      />
      <ModelSelectionSetting
        config={props.config}
        icon="sparkles"
        label={translator.message("mobile.agents.fallbackModel")}
        purpose="agent"
        selection={settings.fallbackModelSelection}
        defaultLabel={translator.message("mobile.agents.none")}
        disabled={disabledFor("fallbackModelSelection")}
        onSelect={(selection) =>
          void props.updateSettings(
            { fallbackModelSelection: selection },
            translator.message("mobile.agents.fallbackModel"),
          )
        }
      />
      <SettingsRow
        icon="folder"
        label={translator.message("mobile.agents.modelScope")}
        value={project?.title ?? translator.message("mobile.agents.environmentDefault")}
        onPress={() => setScopeOpen(true)}
      />
      <ModelSelectionSetting
        config={props.config}
        projectId={selectedProjectId}
        icon="text.bubble"
        label={translator.message("mobile.settings.agents.textGeneration")}
        purpose="text-generation"
        allowDefault={selectedProjectId !== null}
        selection={textSelection}
        defaultLabel={translator.message("mobile.agents.inheritTextModel")}
        disabled={disabledFor(
          selectedProjectId === null
            ? "textGenerationModelSelection"
            : `projectSettingsOverrides.${selectedProjectId}.textGenerationModelSelection`,
        )}
        onSelect={(selection) =>
          void props.updateSettings(
            textGenerationModelSettingsPatch(settings, selectedProjectId, selection),
            translator.message("mobile.settings.agents.textGeneration"),
          )
        }
      />
      <ModelSelectionSetting
        config={props.config}
        icon="sparkles"
        label={translator.message("mobile.settings.agents.fetchWorkers")}
        defaultLabel={translator.message("mobile.settings.agents.automatic")}
        purpose="text-generation"
        selection={settings.fetchModelSelection}
        disabled={disabledFor("fetchModelSelection")}
        optionPredicate={(option) =>
          props.config.providers.some(
            (provider) =>
              provider.instanceId === option.selection.instanceId &&
              isFetchCapableProvider(provider),
          )
        }
        onSelect={(selection) =>
          void props.updateSettings(
            { fetchModelSelection: selection },
            translator.message("mobile.settings.agents.fetchWorkers"),
          )
        }
      />
      <ModelSelectionSetting
        config={props.config}
        icon="arrow.triangle.branch"
        label={translator.message("mobile.settings.agents.parallelReview")}
        allowDefault={false}
        purpose="text-generation"
        selection={settings.parallelPlanReviewModelSelection}
        disabled={disabledFor("parallelPlanReviewModelSelection")}
        optionPredicate={(option) =>
          props.config.providers.some(
            (provider) =>
              provider.instanceId === option.selection.instanceId &&
              supportsAutoReasoningEvaluationProvider(provider),
          )
        }
        onSelect={(selection) => {
          if (selection)
            void props.updateSettings(
              { parallelPlanReviewModelSelection: selection },
              translator.message("mobile.settings.agents.parallelReview"),
            );
        }}
      />
      <ModelSelectionSetting
        config={props.config}
        icon="mic"
        label={translator.message("mobile.settings.agents.voiceTranslation")}
        defaultLabel={translator.message("mobile.settings.agents.textGenerationModel")}
        purpose="text-generation"
        selection={settings.voiceTranslationModelSelection}
        disabled={disabledFor("voiceTranslationModelSelection")}
        onSelect={(selection) =>
          void props.updateSettings(
            { voiceTranslationModelSelection: selection },
            translator.message("mobile.settings.agents.voiceTranslation"),
          )
        }
      />
      {scopeOpen ? (
        <AgentSettingsSheet
          title={translator.message("mobile.agents.modelScope")}
          onClose={() => setScopeOpen(false)}
        >
          <ListChoiceRow
            label={translator.message("mobile.agents.environmentDefault")}
            selected={selectedProjectId === null}
            onPress={() => {
              setProjectId(null);
              setScopeOpen(false);
            }}
          />
          {props.projects.map((candidate) => (
            <ListChoiceRow
              key={candidate.id}
              label={candidate.title}
              description={candidate.workspaceRoot}
              selected={selectedProjectId === candidate.id}
              onPress={() => {
                setProjectId(candidate.id);
                setScopeOpen(false);
              }}
            />
          ))}
        </AgentSettingsSheet>
      ) : null}
    </>
  );
}
