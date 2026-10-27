import { useChatBubblePalette } from "./ChatBubble";
import type { DeepPlanEvidence, DeepPlanRun, DeepPlanStepStatus } from "@t3tools/contracts";
import {
  deepPlanCitationTitles,
  getDeepPlanComposerChecklistExpiresAt,
  selectDeepPlanProgress,
  selectDeepPlanSteps,
  selectDeepPlanSourceAnalysis,
} from "@t3tools/client-runtime/deep-planning";
import { memo, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

function Evidence(props: { readonly evidence: ReadonlyArray<DeepPlanEvidence> }) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="gap-1">
      <Text className="text-xs font-t3-semibold text-foreground">
        {translator.message("chat.deepPlan.evidence")}
      </Text>
      {props.evidence.length === 0 ? (
        <Text className="text-xs text-foreground-muted">
          {translator.message("chat.deepPlan.noEvidence")}
        </Text>
      ) : (
        props.evidence.map((evidence) => (
          <Text
            key={JSON.stringify([
              evidence.createdAt,
              evidence.kind,
              evidence.summary,
              evidence.reference,
            ])}
            selectable
            className="text-xs text-foreground-muted"
          >
            {evidence.summary}
            {evidence.reference ? ` · ${evidence.reference}` : ""}
          </Text>
        ))
      )}
    </View>
  );
}

function StepStatus(props: { readonly status: DeepPlanStepStatus }) {
  const translator = useMobileInterfaceTranslator();
  return (
    <Text
      className={
        props.status === "verified"
          ? "text-xs font-t3-medium text-adaptive-emerald-600-400"
          : props.status === "blocked" || props.status === "failed"
            ? "text-xs font-t3-medium text-danger"
            : "text-xs font-t3-medium text-foreground-muted"
      }
    >
      {translator.message(`chat.deepPlan.status.${props.status}`)}
    </Text>
  );
}

export const DeepPlanChecklist = memo(function DeepPlanChecklist(props: {
  readonly run: DeepPlanRun;
  readonly maxHeight?: number;
  readonly embedded?: boolean;
  readonly onResume?: () => Promise<void>;
  readonly resumeDisabled?: boolean;
  readonly canContinue?: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const palette = useChatBubblePalette("warning");
  const [expanded, setExpanded] = useState(true);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<{
    readonly revision: number;
    readonly message: string;
  } | null>(null);
  const run = props.run;
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = props.embedded ? null : getDeepPlanComposerChecklistExpiresAt(run);
  useEffect(() => {
    if (expiresAt === null || expiresAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  const expired = expiresAt !== null && expiresAt <= now;
  const plan = run.plan;
  const steps = selectDeepPlanSteps(run);
  const progress = selectDeepPlanProgress(run);
  const verifiedCount = progress.verifiedSteps;
  const analyzedCount = progress.summarizedSourceCount;
  const sourceAnalysis = selectDeepPlanSourceAnalysis(run, translator);
  const sourceErrors = run.sourceCoverage.filter(
    (source) => source.status === "failed" || source.status === "unavailable",
  );
  const sourceTitles = new Map(run.sources.map((source) => [source.sourceId, source.threadTitle]));
  const currentStep = steps.find((row) => row.status === "inProgress")?.step;
  const validationStatus =
    run.finalValidation.status === "passed" ? "verified" : run.finalValidation.status;
  const resumable =
    ["paused", "failed", "blocked"].includes(run.phase) ||
    (props.canContinue === true &&
      ["collecting", "planning", "implementing"].includes(run.phase) &&
      !progress.allStepsVerified);

  if (expired) return null;

  return (
    <View
      className={
        props.embedded
          ? "overflow-hidden"
          : "mx-3 mb-2 overflow-hidden rounded-2xl border border-border bg-card"
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={translator.message(
          expanded ? "chat.deepPlan.collapse" : "chat.deepPlan.expand",
        )}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        className="min-h-11 flex-row items-center gap-2 px-3 py-2"
      >
        <SymbolView
          name={{ ios: "list.bullet.clipboard", android: "auto_awesome" }}
          size={17}
          tintColorClassName="accent-icon"
        />
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-t3-semibold text-foreground" numberOfLines={1}>
            {translator.message(plan ? "chat.deepPlan.checklist" : "chat.deepPlan.analysisTitle")}
          </Text>
          <Text
            className="text-xs text-foreground-muted"
            numberOfLines={1}
            accessibilityLiveRegion="polite"
          >
            {plan
              ? translator.message("chat.deepPlan.stepProgress", {
                  completed: verifiedCount,
                  total: plan.steps.length,
                })
              : run.phase === "collecting"
                ? translator.message("chat.deepPlan.collecting")
                : translator.message("chat.deepPlan.analysisProgress", {
                    completed: analyzedCount,
                    total: run.sources.length,
                  })}
          </Text>
        </View>
        <SymbolView
          name={expanded ? "chevron.up" : "chevron.down"}
          size={12}
          tintColorClassName="accent-icon-muted"
        />
      </Pressable>
      {expanded ? (
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!props.embedded}
          style={props.embedded ? undefined : { maxHeight: props.maxHeight ?? 240 }}
          className="border-t border-border-subtle"
          contentContainerStyle={{ paddingBottom: 8 }}
        >
          <View className="gap-2 px-3 py-2">
            {plan ? (
              <Text className="text-xs text-foreground-muted">
                {translator.message("chat.deepPlan.analysisProgress", {
                  completed: analyzedCount,
                  total: run.sources.length,
                })}
              </Text>
            ) : null}
            {run.phase === "collecting" ? (
              <Text className="text-xs text-foreground-muted">
                {translator.message("chat.deepPlan.collectingHint")}
              </Text>
            ) : null}
            {!plan && run.phase !== "collecting"
              ? sourceAnalysis
                  .filter((entry) => !entry.complete && !entry.failed)
                  .map(({ source, label }) => (
                    <View key={source.sourceId} className="gap-1">
                      <Text className="text-xs text-foreground">{source.threadTitle}</Text>
                      <Text className="text-xs text-foreground-muted">{label}</Text>
                    </View>
                  ))
              : null}
            {currentStep ? (
              <Text className="text-xs text-foreground" accessibilityLiveRegion="polite">
                {translator.message("chat.deepPlan.currentStep", { title: currentStep.title })}
              </Text>
            ) : null}
            {run.pauseReason ? (
              <Text accessibilityRole="alert" className="text-xs text-danger">
                {run.pauseReason}
              </Text>
            ) : null}
            {resumable && props.onResume ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  busy: resuming,
                  disabled: resuming || props.resumeDisabled === true,
                }}
                disabled={resuming || props.resumeDisabled === true}
                className="min-h-11 items-center justify-center rounded-xl border border-border px-3"
                style={
                  palette.better && props.embedded
                    ? ({ pressed }) => ({
                        backgroundColor: pressed ? palette.hover : palette.control,
                        borderRadius: 999,
                        borderWidth: 0,
                      })
                    : undefined
                }
                onPress={async () => {
                  setResuming(true);
                  setResumeError(null);
                  try {
                    await props.onResume?.();
                  } catch (error) {
                    setResumeError({
                      revision: run.revision,
                      message:
                        error instanceof Error
                          ? error.message
                          : translator.message("chat.deepPlan.resumeFailed"),
                    });
                  } finally {
                    setResuming(false);
                  }
                }}
              >
                <Text className="text-sm font-t3-medium text-foreground">
                  {translator.message(resuming ? "chat.deepPlan.resuming" : "chat.deepPlan.resume")}
                </Text>
              </Pressable>
            ) : null}
            {resumeError?.revision === run.revision ? (
              <Text accessibilityRole="alert" className="text-xs text-danger">
                {resumeError.message}
              </Text>
            ) : null}
            {sourceErrors.map((source) => (
              <Text key={source.sourceId} accessibilityRole="alert" className="text-xs text-danger">
                {sourceTitles.get(source.sourceId) ??
                  translator.message("chat.deepPlan.sourceUnavailable")}
                {source.error ? `: ${source.error}` : ""}
              </Text>
            ))}
          </View>
          {steps.map(({ step, status, evidence }, index) => {
            const stepExpanded = expandedStepId === step.id;
            const sources = deepPlanCitationTitles(
              step.sources,
              run.sources,
              translator.message("chat.deepPlan.sourceUnavailable"),
            );
            return (
              <View key={step.id} className="border-t border-border-subtle">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: stepExpanded }}
                  onPress={() => setExpandedStepId(stepExpanded ? null : step.id)}
                  className="min-h-11 flex-row items-center gap-2 px-3 py-2"
                >
                  <SymbolView
                    name={status === "verified" ? "checkmark.circle" : "circle"}
                    size={14}
                    tintColorClassName={
                      status === "verified"
                        ? "accent-adaptive-emerald-600-400"
                        : "accent-icon-muted"
                    }
                  />
                  <Text className="text-xs text-foreground-muted">{index + 1}.</Text>
                  <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={2}>
                    {step.title}
                  </Text>
                  <StepStatus status={status} />
                </Pressable>
                {stepExpanded ? (
                  <View className="gap-3 px-3 pb-3">
                    <Text selectable className="text-xs text-foreground-muted">
                      {step.description}
                    </Text>
                    {sources.length > 0 ? (
                      <Text selectable className="text-xs text-foreground-muted">
                        {translator.message("chat.deepPlan.sources")}: {sources.join("; ")}
                      </Text>
                    ) : null}
                    {step.dependencies.length > 0 ? (
                      <Text selectable className="text-xs text-foreground-muted">
                        {translator.message("chat.deepPlan.dependencies")}:{" "}
                        {step.dependencies
                          .map(
                            (id) => plan?.steps.find((dependency) => dependency.id === id)?.title,
                          )
                          .filter(Boolean)
                          .join("; ")}
                      </Text>
                    ) : null}
                    <View className="gap-1">
                      <Text className="text-xs font-t3-semibold text-foreground">
                        {translator.message("chat.deepPlan.requirements")}
                      </Text>
                      {step.acceptanceCriteria.map((criterion) => {
                        const titles = deepPlanCitationTitles(
                          criterion.sources,
                          run.sources,
                          translator.message("chat.deepPlan.sourceUnavailable"),
                        );
                        return (
                          <Text
                            key={criterion.id}
                            selectable
                            className="text-xs text-foreground-muted"
                          >
                            {criterion.description}
                            {"\n"}
                            {criterion.checkMethod}
                            {titles.length > 0
                              ? `\n${translator.message("chat.deepPlan.sources")}: ${titles.join("; ")}`
                              : ""}
                          </Text>
                        );
                      })}
                    </View>
                    <Evidence evidence={evidence} />
                  </View>
                ) : null}
              </View>
            );
          })}
          {plan ? (
            <View className="gap-2 border-t border-border-subtle px-3 py-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-sm font-t3-medium text-foreground">
                  {translator.message("chat.deepPlan.finalValidation")}
                </Text>
                <StepStatus status={validationStatus} />
              </View>
              <Text selectable className="text-xs text-foreground-muted">
                {plan.finalValidation.description}
                {"\n"}
                {plan.finalValidation.checkMethod}
              </Text>
              <Evidence evidence={run.finalValidation.evidence} />
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
});
