import {
  SourceControlWritingStyleMode,
  type EnvironmentId,
  type ModelSelection,
  type ServerSettingsPatch,
} from "@t3tools/contracts";

import { ListChoiceRow as SettingsChoiceRow } from "../../../components/ui/ListChoiceRow";
import { AppText as Text } from "../../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { useEnvironmentServerConfig } from "../../../state/entities";
import { ModelSelectionSetting } from "../ModelSelectionSetting";
import { buildWritingStylePatch, uniformWritingStyleField } from "../server-controls-settings";
import { uniformMobileSetting, type ScopedMobileSettingsTarget } from "../settings-scoped-server";
import { SettingsSection } from "./SettingsSection";
import { SettingsSwitchRow } from "./SettingsSwitchRow";
import { SettingsTextFieldSection } from "./SettingsTextFieldSection";

const MODE_MESSAGES = {
  repo_conventions: [
    "settings.sourceControlWriting.repoConventions",
    "settings.sourceControlWriting.repoConventionsDescription",
  ],
  conventional_commits: [
    "settings.sourceControlWriting.conventionalCommits",
    "settings.sourceControlWriting.conventionalCommitsDescription",
  ],
  custom: [
    "settings.sourceControlWriting.custom",
    "settings.sourceControlWriting.customDescription",
  ],
} as const satisfies Record<SourceControlWritingStyleMode, readonly InterfaceMessageKey[]>;

/**
 * Change descriptions, pull request text and review guides. The writer and guide models only
 * show for one target, since each environment lists its own models.
 */
export function SourceControlWritingSettings(props: {
  readonly targets: readonly ScopedMobileSettingsTarget[];
  readonly projectSelected: boolean;
  readonly pending: boolean;
  readonly disabledFor: (key: string) => boolean;
  readonly managed: (key: string) => string | undefined;
  readonly write: (patch: ServerSettingsPatch) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const { targets, disabledFor, managed, write } = props;
  const mode = uniformWritingStyleField(targets, "mode");
  const styleDisabled = disabledFor("sourceControlWritingStyle");
  const only = targets.length === 1 ? targets[0] : undefined;
  const reviewGuidesEnabled = uniformMobileSetting(targets, "reviewGuidesEnabled");
  const writeStyle = (change: Parameters<typeof buildWritingStylePatch>[2]) =>
    write(buildWritingStylePatch(targets, props.projectSelected, change));
  const modelRow = (
    key: "sourceControlWriterModelSelection" | "reviewGuideModelSelection",
    label: string,
  ) =>
    only === undefined ? null : (
      <ModelRow
        environmentId={only.environment.environmentId}
        label={label}
        selection={only.settings[key]}
        onSelect={(selection) => write({ [key]: selection })}
      />
    );

  return (
    <>
      <SettingsSection
        title={translator.message("settings.sourceControlWriting.style")}
        footer={managed("sourceControlWritingStyle")}
        trailing={
          mode === null && !props.pending ? (
            <Text className="px-2 text-sm text-foreground-muted android:px-4">
              {translator.message("git.operation.mixed")}
            </Text>
          ) : null
        }
      >
        {SourceControlWritingStyleMode.literals.map((candidate, index) => (
          <SettingsChoiceRow
            key={candidate}
            label={translator.message(MODE_MESSAGES[candidate][0])}
            description={translator.message(MODE_MESSAGES[candidate][1])}
            selected={mode === candidate}
            separated={index > 0}
            disabled={styleDisabled}
            onPress={() => writeStyle({ mode: candidate })}
          />
        ))}
        <SettingsSwitchRow
          icon="doc.text"
          label={translator.message("settings.sourceControlWriting.followTemplates")}
          subtitle={translator.message("settings.sourceControlWriting.followTemplatesDescription")}
          value={uniformWritingStyleField(targets, "followChangeRequestTemplates")}
          disabled={styleDisabled}
          onValueChange={(value) => writeStyle({ followChangeRequestTemplates: value })}
        />
      </SettingsSection>
      {mode === "custom" ? (
        <SettingsTextFieldSection
          title={translator.message("settings.sourceControlWriting.custom")}
          label={translator.message("settings.sourceControlWriting.customAria")}
          placeholder={translator.message("settings.sourceControlWriting.customPlaceholder")}
          mixedPlaceholder={translator.message(
            "mobile.ui.mixedEnterInstructionsForAllSelectedTargets",
          )}
          value={uniformWritingStyleField(targets, "customInstructions")}
          disabled={styleDisabled}
          onCommit={(customInstructions) => writeStyle({ customInstructions })}
        />
      ) : null}
      {only === undefined ? null : (
        <SettingsSection
          title={translator.message("settings.sourceControlWriting.writerModel")}
          footer={managed("sourceControlWriterModelSelection")}
        >
          {modelRow(
            "sourceControlWriterModelSelection",
            translator.message("settings.sourceControlWriting.writerModel"),
          )}
        </SettingsSection>
      )}
      {props.projectSelected ? null : (
        <SettingsSection
          title={translator.message("mobile.ui.reviewGuides")}
          footer={translator.message("mobile.ui.reviewGuidesDescription")}
        >
          <SettingsSwitchRow
            icon="file.diff"
            label={translator.message("mobile.ui.reviewGuides")}
            value={reviewGuidesEnabled}
            disabled={disabledFor("reviewGuidesEnabled")}
            onValueChange={(value) => write({ reviewGuidesEnabled: value })}
          />
        </SettingsSection>
      )}
      {reviewGuidesEnabled === false ? null : (
        <>
          {only === undefined ? null : (
            <SettingsSection
              title={translator.message("mobile.ui.reviewGuideModel")}
              footer={managed("reviewGuideModelSelection")}
            >
              {modelRow(
                "reviewGuideModelSelection",
                translator.message("mobile.ui.reviewGuideModel"),
              )}
            </SettingsSection>
          )}
          <SettingsTextFieldSection
            title={translator.message("mobile.ui.reviewGuideInstructions")}
            footer={translator.message("mobile.ui.reviewGuideInstructionsDescription")}
            label={translator.message("mobile.ui.reviewGuideInstructions")}
            placeholder={translator.message("mobile.ui.reviewGuideInstructionsPlaceholder")}
            mixedPlaceholder={translator.message(
              "mobile.ui.mixedEnterInstructionsForAllSelectedTargets",
            )}
            value={uniformMobileSetting(targets, "reviewGuideInstructions")}
            disabled={disabledFor("reviewGuideInstructions")}
            onCommit={(reviewGuideInstructions) => write({ reviewGuideInstructions })}
          />
        </>
      )}
    </>
  );
}

function ModelRow(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly selection: ModelSelection | null;
  readonly onSelect: (selection: ModelSelection | null) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const config = useEnvironmentServerConfig(props.environmentId);
  if (config === null) return null;
  return (
    <ModelSelectionSetting
      config={config}
      icon="text.bubble"
      label={props.label}
      purpose="text-generation"
      selection={props.selection}
      defaultLabel={translator.message("mobile.settings.agents.textGenerationModel")}
      onSelect={props.onSelect}
    />
  );
}
