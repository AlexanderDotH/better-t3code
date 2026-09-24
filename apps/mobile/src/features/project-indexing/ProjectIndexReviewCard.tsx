import type {
  EnvironmentId,
  ProjectIndexModelCheckResult,
  ProjectIndexReviewResultV1,
  ProjectIndexReviewSelection,
  ProjectIndexScopeInput,
  ProjectIndexSettingsPatch,
  ProjectIndexStatusV1,
  ServerConfig,
} from "@t3tools/contracts";
import { resolveProjectIndexSettings } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { SettingsSection } from "../settings/components/SettingsSection";
import {
  ModelSelectionModal,
  modelSelectionLabel,
} from "../settings/SettingsAgentEnvironmentsRouteScreen";
import { ProjectIndexActionButton } from "./ProjectIndexControls";
import { ProjectIndexSourceButton } from "./ProjectIndexSourceButton";

export function ProjectIndexReviewCard(props: {
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
  readonly config: ServerConfig;
  readonly status: ProjectIndexStatusV1;
  readonly modelCheck: ProjectIndexModelCheckResult | null;
  readonly checkingModel: boolean;
  readonly disabled: boolean;
  readonly onUpdate: (patch: ProjectIndexSettingsPatch) => void;
  readonly onReview: (
    selection: ProjectIndexReviewSelection,
  ) => Promise<ProjectIndexReviewResultV1>;
}) {
  const translator = useMobileInterfaceTranslator();
  const [selection, setSelection] = useState<ProjectIndexReviewSelection>("workingtree");
  const [result, setResult] = useState<ProjectIndexReviewResultV1 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelSelection = resolveProjectIndexSettings(
    props.status.settings,
    props.status.defaults,
  ).modelSelection;
  const modelReady = props.modelCheck?.supported === true && !props.checkingModel;

  const review = async () => {
    if (props.disabled || busy || !modelReady) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await props.onReview(selection));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : translator.message("knowledgeGraph.error"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title={translator.message("projectIndexing.reviewEnabled")} card>
      <View className="gap-4 p-4">
        <Text className="text-sm text-foreground-muted">
          {translator.message("projectIndexing.reviewDescription")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translator.message("projectIndexing.reviewModel")}
          disabled={props.disabled || busy}
          className="min-h-12 gap-1 rounded-xl bg-subtle p-3 disabled:opacity-45"
          onPress={() => setModelPickerOpen(true)}
        >
          <Text className="text-sm font-t3-semibold text-foreground">
            {translator.message("projectIndexing.reviewModel")}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {modelSelection
              ? modelSelectionLabel(props.config, modelSelection)
              : translator.message("projectIndexing.modelRequired")}
          </Text>
          <Text className="text-xs text-foreground-muted">
            {translator.message("projectIndexing.reviewModelDescription")}
          </Text>
        </Pressable>
        {!modelReady ? (
          <Text accessibilityRole="alert" className="text-sm text-foreground-muted">
            {props.checkingModel
              ? translator.message("projectIndexing.checkingModel")
              : (props.modelCheck?.reason ?? translator.message("projectIndexing.modelRequired"))}
          </Text>
        ) : null}
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={translator.message("projectIndexing.reviewScope")}
          className="flex-row flex-wrap gap-2"
        >
          {(["workingtree", "staged"] as const).map((candidate) => (
            <Pressable
              key={candidate}
              accessibilityRole="radio"
              accessibilityState={{ checked: candidate === selection, disabled: busy }}
              disabled={busy}
              className={
                candidate === selection
                  ? "rounded-full bg-primary px-4 py-3"
                  : "rounded-full border border-border bg-subtle px-4 py-3"
              }
              onPress={() => {
                setSelection(candidate);
                setResult(null);
              }}
            >
              <Text
                className={
                  candidate === selection
                    ? "text-sm font-t3-semibold text-primary-foreground"
                    : "text-sm text-foreground"
                }
              >
                {translator.message(`projectIndexing.reviewScope.${candidate}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <ProjectIndexActionButton
          label={translator.message(
            busy ? "projectIndexing.reviewing" : "projectIndexing.reviewChanges",
          )}
          disabled={props.disabled || busy || !modelReady}
          onPress={() => {
            void review();
          }}
        />
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground" selectable>
            {error}
          </Text>
        ) : null}
        {result ? (
          <View className="gap-3">
            <Text className="text-sm text-foreground" selectable>
              {result.summary}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {translator.message(`projectIndexing.usage.${result.usage.usageStatus}`)}
            </Text>
            {result.findings.length === 0 && result.state === "completed" ? (
              <Text className="text-sm text-foreground-muted">
                {translator.message("projectIndexing.noReviewFindings")}
              </Text>
            ) : null}
            {result.gaps.map((gap) => (
              <Text key={gap.id} className="text-sm text-foreground-muted" selectable>
                {gap.message}
              </Text>
            ))}
            {result.findings.map((finding) => {
              return (
                <View key={finding.id} className="gap-2 rounded-2xl border border-border p-3">
                  <Text className="text-xs font-t3-semibold text-foreground-muted">
                    {translator.message(`projectIndexing.severity.${finding.severity}`)} ·{" "}
                    {translator.message(`projectIndexing.reviewCategory.${finding.category}`)}
                  </Text>
                  <Text className="text-sm text-foreground" selectable>
                    {finding.message}
                  </Text>
                  <Text className="text-xs text-foreground-muted" selectable>
                    {finding.filePath}:{finding.range.startLine}–{finding.range.endLine}
                  </Text>
                  {finding.sourceSide ? (
                    <Text className="text-xs text-foreground-muted">
                      {translator.message(`projectIndexing.reviewSource.${finding.sourceSide}`)}
                    </Text>
                  ) : null}
                  {finding.diffExcerpt ? (
                    <View className="gap-1 rounded-xl bg-subtle p-3">
                      <Text className="text-xs text-foreground-muted">
                        {translator.message("projectIndexing.reviewSource.excerpt")}
                      </Text>
                      <Text className="font-mono text-xs text-foreground" selectable>
                        {finding.diffExcerpt}
                      </Text>
                    </View>
                  ) : null}
                  {finding.sourceSide !== "before" ? (
                    <ProjectIndexSourceButton
                      environmentId={props.environmentId}
                      scope={props.scope}
                      source={finding}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
      <ModelSelectionModal
        config={props.config}
        current={props.status.settings.modelSelection}
        allowDefault={props.status.defaults !== undefined}
        defaultLabel={translator.message("projectIndexing.useDefaultModel")}
        visible={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        onSelect={(selection) => props.onUpdate({ modelSelection: selection })}
      />
    </SettingsSection>
  );
}
