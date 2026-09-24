import {
  type ProjectIndexControlAction,
  type ProjectIndexSettingsPatch,
  type ProjectIndexStatusV1,
  type ServerConfig,
} from "@t3tools/contracts";
import { useState } from "react";
import { deriveProjectIndexStage } from "@t3tools/client-runtime/project-indexing";
import { Alert, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ProjectIndexActionButton } from "../project-indexing/ProjectIndexControls";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const MAX_VISIBLE_GAPS = 8;

export interface ProjectIndexingSettingsCardProps {
  readonly status: ProjectIndexStatusV1;
  readonly config: ServerConfig;
  readonly projectLabel: string;
  readonly busy: boolean;
  readonly readOnly: boolean;
  readonly actions: {
    readonly canStart: boolean;
    readonly canRebuild: boolean;
    readonly canPause: boolean;
    readonly canResume: boolean;
    readonly canCancel: boolean;
    readonly canClear: boolean;
  };
  readonly onUpdate: (patch: ProjectIndexSettingsPatch) => void;
  readonly onStart: (rebuild: boolean) => void;
  readonly onControl: (action: ProjectIndexControlAction) => void;
}

export function ProjectIndexingSettingsCard(props: ProjectIndexingSettingsCardProps) {
  const translator = useMobileInterfaceTranslator();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const disabled = props.busy || props.readOnly;
  const { status } = props;
  const { settings, coverage } = status;
  const failed = status.state === "failed";
  const lastError = status.lastError ?? status.job?.lastError;
  const staticGaps = status.gaps.filter(
    (gap) => gap.kind !== "provider-error" && gap.kind !== "incomplete-analysis",
  );
  const gaps = staticGaps.slice(0, MAX_VISIBLE_GAPS);
  const issueCount = `${translator.number(staticGaps.length)}${staticGaps.some((gap) => gap.id === "runtime:additional-gaps") ? "+" : ""}`;

  return (
    <SettingsSection title={translator.message("projectIndexing.title")} card>
      <SettingsSwitchRow
        disabled={disabled}
        icon="point.3.connected.trianglepath.dotted"
        label={translator.message("projectIndexing.enabled")}
        subtitle={translator.message("projectIndexing.enabledDescription")}
        value={settings.enabled}
        onValueChange={(enabled) => props.onUpdate({ enabled })}
      />
      <View className="gap-4 border-t border-border-subtle p-4">
        {status.defaults?.enabled === false ? (
          <Text className="text-sm text-foreground-muted">
            {translator.message("projectIndexing.masterOff")}
          </Text>
        ) : null}
        {props.readOnly ? (
          <Text className="text-sm text-foreground-muted">
            {translator.message("projectIndexing.readOnly")}
          </Text>
        ) : null}
        <View className="gap-2">
          <Text
            className={
              failed
                ? "text-base font-t3-semibold text-danger-foreground"
                : "text-base font-t3-semibold text-foreground"
            }
          >
            {translator.message(`projectIndexing.state.${deriveProjectIndexStage(status)}`)}
          </Text>
          {failed ? (
            <Text className="text-sm text-foreground-muted">
              {translator.message("projectIndexing.failedSummary")}
            </Text>
          ) : null}
          <Text className="text-sm text-foreground-muted">
            {coverage.totalImports === undefined
              ? translator.message("projectIndexing.chatFileProgress", {
                  indexed: coverage.indexedFiles,
                  eligible: coverage.eligibleFiles,
                })
              : translator.message("projectIndexing.staticFacts", {
                  files: coverage.indexedFiles,
                  symbols: coverage.totalEntities,
                  imports: coverage.totalImports,
                  calls: coverage.resolvedCallsites,
                })}
          </Text>
          {detailsOpen ? (
            <>
              <Text className="text-sm text-foreground-muted">
                {translator.message("projectIndexing.fileGaps", {
                  skipped: coverage.skippedFiles,
                  failed: coverage.failedFiles,
                })}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {translator.message("projectIndexing.callsiteCoverage", {
                  resolved: coverage.resolvedCallsites,
                  candidate: coverage.candidateCallsites,
                  unresolved: coverage.unresolvedCallsites,
                })}
              </Text>
              {coverage.totalImports !== undefined && coverage.resolvedImports !== undefined ? (
                <Text className="text-sm text-foreground-muted">
                  {translator.message("projectIndexing.resolvedImports", {
                    resolved: coverage.resolvedImports,
                    total: coverage.totalImports,
                  })}
                </Text>
              ) : null}
              <Text className="text-xs text-foreground-muted">
                {translator.message("projectIndexing.updatedAt", {
                  time: translator.date(new Date(status.updatedAt), { timeStyle: "short" }),
                })}
              </Text>
            </>
          ) : null}
        </View>
        {lastError ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground" selectable>
            {lastError}
          </Text>
        ) : failed && gaps[0] ? (
          <Text className="text-sm text-foreground-muted" numberOfLines={2} selectable>
            {translator.message("projectIndexing.reportedIssue")}: {gaps[0].message}
          </Text>
        ) : null}
        {detailsOpen && gaps.length > 0 ? (
          <View className="gap-2 rounded-2xl bg-subtle p-3">
            <Text className="text-sm font-t3-semibold text-foreground">
              {translator.message("projectIndexing.gaps", { count: staticGaps.length })}
            </Text>
            {gaps.map((gap) => (
              <View key={gap.id} className="gap-1">
                <Text className="text-sm text-foreground-muted" selectable>
                  {gap.message}
                </Text>
                {gap.filePath ? (
                  <Text className="text-xs text-foreground-muted" selectable>
                    {gap.filePath}
                  </Text>
                ) : null}
              </View>
            ))}
            {staticGaps.length > gaps.length ? (
              <Text className="text-xs text-foreground-muted">
                {translator.message("projectIndexing.moreGaps", {
                  count: staticGaps.length - gaps.length,
                })}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {!props.actions.canPause && !props.actions.canResume ? (
            <ProjectIndexActionButton
              label={translator.message(
                failed ? "projectIndexing.retryIndexing" : "projectIndexing.analyze",
              )}
              primary
              disabled={disabled || !props.actions.canStart}
              onPress={() => props.onStart(false)}
            />
          ) : null}
          {props.actions.canPause || props.actions.canResume ? (
            <ProjectIndexActionButton
              label={translator.message(
                props.actions.canResume
                  ? "projectIndexing.resumeIndexing"
                  : "projectIndexing.pause",
              )}
              primary={props.actions.canResume}
              disabled={disabled || (!props.actions.canPause && !props.actions.canResume)}
              onPress={() => props.onControl(props.actions.canResume ? "resume" : "pause")}
            />
          ) : null}
          {props.actions.canCancel ? (
            <ProjectIndexActionButton
              label={translator.message("projectIndexing.cancel")}
              disabled={disabled || !props.actions.canCancel}
              onPress={() => props.onControl("cancel")}
            />
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsOpen }}
          className="min-h-11 justify-center"
          onPress={() => setDetailsOpen((open) => !open)}
        >
          <Text className="text-sm text-foreground-muted">
            {translator.message("projectIndexing.indexDetails")}
            {staticGaps.length > 0
              ? ` · ${translator.message("projectIndexing.reportedIssues", { count: issueCount })}`
              : ""}
          </Text>
        </Pressable>
        {detailsOpen ? (
          <View className="gap-3 border-t border-border-subtle pt-3">
            <Text className="text-sm font-t3-semibold text-foreground-muted">
              {translator.message("projectIndexing.options")}
            </Text>
            <SettingsSwitchRow
              disabled={disabled}
              icon="checkmark.shield"
              label={translator.message("projectIndexing.reviewEnabled")}
              subtitle={translator.message("projectIndexing.reviewEnabledDescription")}
              value={settings.reviewEnabled}
              onValueChange={(reviewEnabled) => props.onUpdate({ reviewEnabled })}
            />
            <Text className="text-sm font-t3-semibold text-foreground-muted">
              {translator.message("projectIndexing.maintenance")}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <ProjectIndexActionButton
                label={translator.message("projectIndexing.rebuild")}
                disabled={disabled || !props.actions.canRebuild}
                onPress={() => props.onStart(true)}
              />
              <ProjectIndexActionButton
                label={translator.message("projectIndexing.clear")}
                destructive
                disabled={disabled || !props.actions.canClear}
                onPress={() => {
                  Alert.alert(
                    translator.message("projectIndexing.clearTitle"),
                    translator.message("projectIndexing.clearDescription", {
                      project: props.projectLabel,
                      environment: props.config.environment.label,
                    }),
                    [
                      { text: translator.message("common.cancel"), style: "cancel" },
                      {
                        text: translator.message("projectIndexing.clear"),
                        style: "destructive",
                        onPress: () => props.onControl("clear"),
                      },
                    ],
                  );
                }}
              />
            </View>
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}
