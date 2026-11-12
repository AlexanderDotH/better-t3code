import { projectIndexingDefaultsSupported } from "@t3tools/client-runtime/project-indexing";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ProjectIndexModelCheckResult,
  type ProjectIndexModelSelection,
  type ServerConfig,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { bindProjectIndexApi } from "../../state/project-index";
import { readEnvironmentScope } from "../../state/session";
import { AgentSettingsButton } from "./AgentSettingsFields";
import { ModelSelectionSetting } from "./ModelSelectionSetting";

export function MobileProjectIndexDefaultModelSetting(props: {
  readonly environmentId: EnvironmentId;
  readonly config: ServerConfig;
  readonly disabled: boolean;
  readonly updateSettings: (patch: ServerSettingsPatch) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [checkAttempt, setCheckAttempt] = useState(0);
  const selection = props.config.settings.projectIndexingDefaultModelSelection;
  const selectionKey = JSON.stringify(selection);
  const supported =
    projectIndexingDefaultsSupported(props.config.environment.capabilities) &&
    (props.config.environment.capabilities.projectIndexingVersion ?? 0) >= 3;
  return (
    <View className="gap-2">
      <ModelSelectionSetting
        config={props.config}
        icon="sparkles"
        label={translator.message("projectIndexing.defaultModel")}
        purpose="text-generation"
        defaultLabel={translator.message("mobile.agents.none")}
        selection={selection}
        disabled={props.disabled || !supported}
        onSelect={(projectIndexingDefaultModelSelection) =>
          props.updateSettings({ projectIndexingDefaultModelSelection })
        }
      />
      {selection ? (
        <View className="px-4">
          <AgentSettingsButton
            label={translator.message("common.clear")}
            disabled={props.disabled || !supported}
            onPress={() => props.updateSettings({ projectIndexingDefaultModelSelection: null })}
          />
        </View>
      ) : null}
      <Text className="px-4 text-sm text-foreground-muted">
        {translator.message("projectIndexing.defaultModelDescription")}
      </Text>
      {selection &&
      supported &&
      readEnvironmentScope(props.environmentId, AuthOrchestrationReadScope) ? (
        <View className="gap-2 px-4 pb-3">
          <ProjectIndexDefaultModelCheck
            key={`${props.environmentId}:${selectionKey}:${checkAttempt}`}
            environmentId={props.environmentId}
            selection={selection}
          />
          <AgentSettingsButton
            label={translator.message("projectIndexing.checkModelAgain")}
            onPress={() => setCheckAttempt((attempt) => attempt + 1)}
          />
        </View>
      ) : (
        <Text className="px-4 pb-3 text-sm text-foreground-muted">
          {translator.message(
            supported
              ? selection
                ? "projectIndexing.readOnly"
                : "projectIndexing.noDefaultModel"
              : "projectIndexing.updateServer",
          )}
        </Text>
      )}
    </View>
  );
}

function ProjectIndexDefaultModelCheck(props: {
  readonly environmentId: EnvironmentId;
  readonly selection: ProjectIndexModelSelection;
}) {
  const translator = useMobileInterfaceTranslator();
  const [result, setResult] = useState<ProjectIndexModelCheckResult | null>(null);
  const [target] = useState(props);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- checks the selected model on the remote environment and ignores results after unmount
  useEffect(() => {
    let active = true;
    void settlePromise(() =>
      bindProjectIndexApi(target.environmentId).checkModel({ modelSelection: target.selection }),
    ).then((checked) => {
      if (!active) return;
      if (checked._tag === "Success") setResult(checked.value);
      else {
        const error = squashAtomCommandFailure(checked);
        setResult({
          supported: false,
          reason:
            error instanceof Error
              ? error.message
              : translator.message("projectIndexing.modelUnsupported"),
        });
      }
    });
    return () => {
      active = false;
    };
  }, [target, translator]);
  return (
    <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
      {translator.message(
        result === null
          ? "projectIndexing.checkingModel"
          : result.supported
            ? "mobile.agents.modelCheckPassed"
            : "projectIndexing.modelUnsupported",
      )}
      {result?.supported === false && result.reason ? `: ${result.reason}` : ""}
    </Text>
  );
}
