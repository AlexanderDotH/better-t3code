import { projectIndexingDefaultsSupported } from "@t3tools/client-runtime/project-indexing";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ServerSettingsPatch } from "@t3tools/contracts";
import { useState } from "react";

import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { ModelSelectionModal, modelSelectionLabel } from "../settings/ModelSelectionModal";
import { mobileProjectIndexPermissions } from "./mobile-project-indexing";
import {
  supportsMobileDecisionModels,
  supportsMobileStaticProjectIndex,
} from "./mobile-project-index-settings";

export function ProjectIndexingDefaultsCard(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel?: string;
}) {
  const translator = useMobileInterfaceTranslator();
  const config = useEnvironmentServerConfig(props.environmentId);
  const session = useEnvironmentQuery(environmentSession.sessionStateAtom(props.environmentId));
  const permissions = mobileProjectIndexPermissions(session.data);
  const staticSupported = supportsMobileStaticProjectIndex(
    config?.environment.capabilities.projectIndexingVersion,
  );
  const supported =
    staticSupported && projectIndexingDefaultsSupported(config?.environment.capabilities);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisionModelPickerOpen, setDecisionModelPickerOpen] = useState(false);
  const disabled = busy || !permissions.canOperate || !supported;
  const decisionModelsSupported = supportsMobileDecisionModels(
    config?.environment.capabilities.decisionModelsVersion,
  );

  const save = async (
    patch: Pick<
      ServerSettingsPatch,
      "projectIndexingEnabled" | "projectIndexingDecisionModelSelection"
    >,
  ) => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      const result = await updateSettings({ environmentId: props.environmentId, input: { patch } });
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        setError(
          cause instanceof Error ? cause.message : translator.message("knowledgeGraph.error"),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title={props.environmentLabel ?? config?.environment.label} card>
      {!config ? (
        <Text className="p-4 text-sm text-foreground-muted">
          {translator.message("projectIndexing.loading")}
        </Text>
      ) : !supported ? (
        <Text className="p-4 text-sm text-foreground-muted">
          {translator.message(
            (config.environment.capabilities.projectIndexingVersion ?? 0) >= 1
              ? "projectIndexing.updateServer"
              : "projectIndexing.unsupported",
          )}
        </Text>
      ) : (
        <>
          <SettingsSwitchRow
            icon="point.3.connected.trianglepath.dotted"
            label={translator.message("projectIndexing.masterEnabled")}
            subtitle={translator.message("projectIndexing.masterDescription")}
            value={config.settings.projectIndexingEnabled}
            disabled={disabled}
            onValueChange={(projectIndexingEnabled) => {
              void save({ projectIndexingEnabled });
            }}
          />
          {decisionModelsSupported ? (
            <>
              <SettingsRow
                disabled={disabled}
                icon="sparkles"
                label={translator.message("betterT3.knowledge.projectIndexingDecisionModel.label")}
                value={
                  config.settings.projectIndexingDecisionModelSelection === null
                    ? translator.message("settings.betterT3.value.projectIndexDecisionOff")
                    : modelSelectionLabel(
                        config,
                        config.settings.projectIndexingDecisionModelSelection,
                      )
                }
                onPress={() => setDecisionModelPickerOpen(true)}
              />
              <Text className="px-4 pb-4 text-sm text-foreground-muted">
                {translator.message("betterT3.knowledge.projectIndexingDecisionModel.description")}
              </Text>
            </>
          ) : null}
          {!permissions.canOperate ? (
            <Text className="px-4 pb-4 text-sm text-foreground-muted">
              {translator.message("projectIndexing.readOnly")}
            </Text>
          ) : null}
        </>
      )}
      {session.error || error ? (
        <Text accessibilityRole="alert" className="p-4 text-sm text-danger-foreground">
          {session.error ?? error}
        </Text>
      ) : null}
      {config && decisionModelsSupported ? (
        <ModelSelectionModal
          config={config}
          current={config.settings.projectIndexingDecisionModelSelection}
          defaultLabel={translator.message("settings.betterT3.value.projectIndexDecisionOff")}
          purpose="decision"
          visible={decisionModelPickerOpen}
          onClose={() => setDecisionModelPickerOpen(false)}
          onSelect={(projectIndexingDecisionModelSelection) => {
            void save({ projectIndexingDecisionModelSelection });
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
