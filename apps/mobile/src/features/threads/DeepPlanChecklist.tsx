import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  getDeepPlanComposerChecklistExpiresAt,
  isDeepPlanLegacyRun,
  selectDeepPlanRunControls,
  selectDeepPlanStatus,
  selectDeepPlanSteps,
  type DeepPlanRunAction,
} from "@t3tools/client-runtime/deep-planning";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import type {
  DeepPlanReview,
  EnvironmentId,
  StoredDeepPlanRun,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

export type DeepPlanControl = DeepPlanRunAction;

const statusColors = {
  info: "text-foreground",
  neutral: "text-foreground-muted",
  warning: "text-warning-foreground",
  success: "text-adaptive-emerald-600-400",
};

function ReviewDetails({ review }: { readonly review: DeepPlanReview }) {
  const translator = useMobileInterfaceTranslator();
  const findings = new Map(review.findings.map((finding) => [JSON.stringify(finding), finding]));
  return (
    <View className="gap-1">
      {review.summary ? (
        <Text selectable className="text-xs text-foreground-muted">
          {review.summary}
        </Text>
      ) : null}
      {findings.size > 0 ? (
        <Text className="text-xs font-t3-semibold text-foreground">
          {translator.message("chat.deepPlan.findings")}
        </Text>
      ) : null}
      {Array.from(findings, ([key, finding]) => (
        <View className="gap-0.5" key={key}>
          <Text className="text-xs font-t3-medium text-foreground">
            {translator.message(`chat.deepPlan.finding.${finding.severity}`)} · {finding.title}
          </Text>
          <Text selectable className="text-xs text-foreground-muted">
            {finding.detail}
          </Text>
          {finding.file || finding.rule ? (
            <Text selectable className="text-xs text-foreground-muted">
              {[
                finding.file && (finding.line ? `${finding.file}:${finding.line}` : finding.file),
                finding.rule,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function DeepPlanChecklist(props: {
  readonly run: StoredDeepPlanRun;
  readonly environmentId: EnvironmentId;
  readonly threadId?: ThreadId;
  readonly threadShells?: ReadonlyArray<{ readonly id: ThreadId }>;
  readonly maxHeight?: number;
  readonly embedded?: boolean;
  readonly controlsDisabled?: boolean;
  readonly deepPlanSupported?: boolean;
  readonly onControl?: ((action: DeepPlanControl) => Promise<void>) | undefined;
  readonly onOpenThread?: (threadId: ThreadId) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const checklistKey = threadKey({
    environmentId: props.environmentId,
    threadId: props.threadId ?? props.run.threadId,
  });
  const expanded = AsyncResult.isSuccess(preferences)
    ? (preferences.value.deepPlanChecklistExpandedByThread?.[checklistKey] ?? true)
    : true;
  const toggleExpanded = () => {
    savePreferences({
      transform: (current) => ({
        deepPlanChecklistExpandedByThread: {
          ...current.deepPlanChecklistExpandedByThread,
          [checklistKey]: !expanded,
        },
      }),
    });
  };
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [pendingControl, setPendingControl] = useState<DeepPlanControl | null>(null);
  const [controlError, setControlError] = useState<{
    readonly runId: StoredDeepPlanRun["id"];
    readonly revision: number;
    readonly message: string;
  } | null>(null);
  const controlInFlight = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const { run, onControl, onOpenThread } = props;
  const expiresAt = props.embedded ? null : getDeepPlanComposerChecklistExpiresAt(run);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Expire the completed checklist from its persisted completion time.
  useEffect(() => {
    if (expiresAt === null || expiresAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  if (expiresAt !== null && expiresAt <= now) return null;
  // Suggest a fresh Deep Plan only for an unfinished legacy run where a new one can start.
  if (isDeepPlanLegacyRun(run) && (run.finished === true || props.deepPlanSupported !== true))
    return null;

  const status = selectDeepPlanStatus(run, props.threadShells, translator);
  const current = isDeepPlanLegacyRun(run) ? null : run;
  const plan = current?.plan;
  const { toggle, cancel } = onControl
    ? selectDeepPlanRunControls(run)
    : { toggle: null, cancel: false };
  const performControl = async (action: DeepPlanControl) => {
    if (!current || !onControl || props.controlsDisabled || controlInFlight.current) return;
    controlInFlight.current = true;
    setPendingControl(action);
    setControlError(null);
    await (async () => onControl(action))()
      .catch((error: unknown) => {
        setControlError({
          runId: current.id,
          revision: current.revision,
          message:
            error instanceof Error
              ? error.message
              : translator.message("chat.deepPlan.controlFailed"),
        });
      })
      .finally(() => {
        controlInFlight.current = false;
        setPendingControl(null);
      });
  };
  const openReview = (review: DeepPlanReview | null | undefined, title: string) =>
    review && onOpenThread ? (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${translator.message("chat.deepPlan.openReview")} · ${title}`}
        onPress={() => onOpenThread(review.reviewThreadId)}
        className="min-h-11 justify-center px-2"
      >
        <Text className="text-xs font-t3-medium text-primary-text">
          {translator.message("chat.deepPlan.openReview")}
        </Text>
      </Pressable>
    ) : null;
  const implementationThreadId = current?.approval?.lanes[0]?.threadId;
  const canOpenImplementation =
    onOpenThread &&
    implementationThreadId &&
    implementationThreadId !== (props.threadId ?? run.threadId);
  const finalReview = current?.finalReview.reviews.at(-1);
  const finalVerdict = current?.finalReview.reviews.findLast((review) => review.verdict !== null);

  return (
    <View
      className={
        props.embedded
          ? "overflow-hidden"
          : "mx-3 mb-2 overflow-hidden rounded-2xl border border-border bg-card"
      }
    >
      {plan ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translator.message(
            expanded ? "chat.deepPlan.collapse" : "chat.deepPlan.expand",
          )}
          accessibilityState={{ expanded }}
          onPress={toggleExpanded}
          className="min-h-11 flex-row items-center gap-2 px-3 py-2"
        >
          <SymbolView
            name={{ ios: "list.bullet.clipboard", android: "auto_awesome" }}
            size={17}
            tintColorClassName="accent-icon"
          />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-t3-semibold text-foreground">
              {translator.message("chat.deepPlan.checklist")}
            </Text>
            <Text
              className={`text-xs ${statusColors[status.tone]}`}
              accessibilityLiveRegion="polite"
            >
              {status.label}
            </Text>
          </View>
          <SymbolView
            name={expanded ? "chevron.down" : "chevron.right"}
            size={12}
            tintColorClassName="accent-icon-muted"
          />
        </Pressable>
      ) : (
        <View className="gap-1 px-3 py-2">
          {current === null && run.schemaVersion === 1 && run.goal ? (
            <Text className="text-sm font-t3-semibold text-foreground">{run.goal}</Text>
          ) : null}
          <Text className={`text-xs ${statusColors[status.tone]}`} accessibilityLiveRegion="polite">
            {status.label}
          </Text>
        </View>
      )}
      {toggle || cancel || canOpenImplementation ? (
        <View className="flex-row flex-wrap gap-1 px-2 pb-2">
          {toggle ? (
            <Button
              tone="text"
              label={translator.message(`chat.deepPlan.${toggle}`)}
              disabled={props.controlsDisabled || pendingControl !== null}
              loading={pendingControl === toggle}
              onPress={() => performControl(toggle)}
            />
          ) : null}
          {cancel ? (
            <Button
              tone="text"
              label={translator.message("chat.deepPlan.cancel")}
              disabled={props.controlsDisabled || pendingControl !== null}
              loading={pendingControl === "cancel"}
              onPress={() =>
                Dialog.confirm({
                  title: translator.message("chat.deepPlan.cancelConfirm"),
                  confirmText: translator.message("chat.deepPlan.cancel"),
                  destructive: true,
                  onConfirm: () => void performControl("cancel"),
                })
              }
            />
          ) : null}
          {canOpenImplementation ? (
            <Button
              tone="text"
              label={translator.message("chat.deepPlan.openImplementation")}
              onPress={() => onOpenThread(implementationThreadId)}
            />
          ) : null}
        </View>
      ) : null}
      {controlError &&
      controlError.runId === current?.id &&
      controlError.revision === current.revision ? (
        <Text accessibilityRole="alert" className="px-3 pb-2 text-xs text-danger">
          {controlError.message}
        </Text>
      ) : null}
      {plan && expanded ? (
        <ScrollView nestedScrollEnabled style={{ maxHeight: props.maxHeight ?? 270 }}>
          {selectDeepPlanSteps(run).map(({ step, status, laneId, review, verdict, roundLimit }) => {
            const stepExpanded = expandedStepId === step.id;
            const laneIndex =
              current?.approval?.lanes.findIndex((lane) => lane.laneId === laneId) ?? -1;
            return (
              <View key={step.id} className="border-t border-border-subtle">
                <View className="flex-row items-center pr-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: stepExpanded }}
                    className="min-h-11 flex-1 justify-center gap-1 px-3 py-2"
                    onPress={() => setExpandedStepId(stepExpanded ? null : step.id)}
                  >
                    <Text className="text-sm font-t3-medium text-foreground">{step.title}</Text>
                    <Text
                      className={`text-xs ${statusColors[status === "verified" ? "success" : status === "changesRequested" ? "warning" : "neutral"]}`}
                    >
                      {[
                        translator.message(`chat.deepPlan.status.${status}`),
                        laneIndex >= 0
                          ? translator.message("chat.deepPlan.lane", { lane: laneIndex + 1 })
                          : null,
                        review
                          ? translator.message("chat.deepPlan.round", {
                              round: review.round,
                              limit: roundLimit,
                            })
                          : null,
                        verdict?.verdict
                          ? translator.message(`chat.deepPlan.verdict.${verdict.verdict}`)
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </Pressable>
                  {openReview(review, step.title)}
                </View>
                {stepExpanded ? (
                  <View className="gap-2 px-3 pb-3">
                    <Text selectable className="text-xs text-foreground-muted">
                      {step.description}
                    </Text>
                    {step.dependencies.length > 0 ? (
                      <Text selectable className="text-xs text-foreground-muted">
                        {translator.message("chat.deepPlan.dependencies")} ·{" "}
                        {step.dependencies
                          .map((id) => plan.steps.find((dependency) => dependency.id === id)?.title)
                          .filter(Boolean)
                          .join(", ")}
                      </Text>
                    ) : null}
                    <Text className="text-xs font-t3-semibold text-foreground">
                      {translator.message("chat.deepPlan.requirements")}
                    </Text>
                    {step.acceptanceCriteria.map((criterion) => (
                      <Text key={criterion.id} selectable className="text-xs text-foreground-muted">
                        {criterion.description}
                        {"\n"}
                        {criterion.checkMethod}
                      </Text>
                    ))}
                    {verdict ? <ReviewDetails review={verdict} /> : null}
                  </View>
                ) : null}
              </View>
            );
          })}
          <View className="gap-1 border-t border-border-subtle px-3 pb-3">
            <View className="min-h-11 flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-sm font-t3-medium text-foreground">
                {translator.message("chat.deepPlan.finalReview")}
              </Text>
              {openReview(finalReview, translator.message("chat.deepPlan.finalReview"))}
            </View>
            {finalReview && current ? (
              <Text className="text-xs text-foreground-muted">
                {translator.message("chat.deepPlan.round", {
                  round: finalReview.round,
                  limit: current.finalReview.roundLimit,
                })}
                {finalVerdict?.verdict
                  ? ` · ${translator.message(`chat.deepPlan.verdict.${finalVerdict.verdict}`)}`
                  : null}
              </Text>
            ) : null}
            <Text selectable className="text-xs text-foreground-muted">
              {plan.finalValidation.description}
              {"\n"}
              {plan.finalValidation.checkMethod}
            </Text>
            {finalVerdict ? <ReviewDetails review={finalVerdict} /> : null}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}
