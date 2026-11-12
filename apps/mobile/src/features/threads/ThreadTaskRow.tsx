import { memo, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { deriveThreadTaskList } from "../../lib/threadActivity";
import { useQuietThreadStructure } from "../../state/use-thread-detail";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

const ThreadTaskRow = memo(function ThreadTaskRow(props: {
  readonly tasks: ReturnType<typeof deriveThreadTaskList>;
}) {
  const translator = useMobileInterfaceTranslator();
  const [expanded, setExpanded] = useState(false);
  const tasks = props.tasks;
  if (!tasks) return null;
  return (
    <View className="rounded-xl border border-border bg-card px-3 py-1">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${translator.message("mobile.timeline.tasks")}: ${translator.message("mobile.timeline.taskProgress", { done: tasks.completed, total: tasks.total })}`}
        onPress={() => setExpanded(!expanded)}
        className="min-h-11 flex-row items-center gap-2"
      >
        <SymbolView name="list.number" size={16} />
        <AppText numberOfLines={1} className="flex-1 text-sm text-foreground">
          {tasks.currentStep}
        </AppText>
        <AppText className="text-xs tabular-nums text-foreground-secondary">
          {tasks.completed}/{tasks.total}
        </AppText>
        <SymbolView name={expanded ? "chevron.up" : "chevron.down"} size={12} />
      </Pressable>
      {expanded ? (
        <ScrollView nestedScrollEnabled style={{ maxHeight: 240 }}>
          {tasks.steps.map((step) => (
            <View key={step.id} className="min-h-9 flex-row items-center gap-2 py-1">
              <SymbolView
                name={
                  step.status === "completed"
                    ? "checkmark.circle.fill"
                    : step.status === "running"
                      ? "circle.inset.filled"
                      : "circle"
                }
                size={14}
              />
              <AppText className="flex-1 text-sm text-foreground">{step.text}</AppText>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
});

/** Lives in the composer stack so it is measured with it and never covers the feed's last rows. */
export function ThreadTaskStrip(props: {
  readonly detailRef: ScopedThreadRef | null;
  readonly threadId: ThreadId;
}) {
  const projection = useQuietThreadStructure(props.detailRef)?.projection;
  const items = projection?.thread.id === props.threadId ? projection.turnItems : undefined;
  const tasks = useMemo(() => deriveThreadTaskList(items ?? []), [items]);
  if (!tasks) return null;
  return (
    <View className="px-3 pb-2">
      <ThreadTaskRow tasks={tasks} />
    </View>
  );
}
