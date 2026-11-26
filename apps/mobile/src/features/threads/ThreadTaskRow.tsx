import { memo, useMemo, useState } from "react";
import { Keyboard, Pressable, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { deriveThreadTaskList } from "../../lib/threadActivity";
import { useQuietThreadStructure } from "../../state/use-thread-detail";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ThreadDetailSheet } from "./ThreadDetailSheet";

const ThreadTaskRow = memo(function ThreadTaskRow(props: {
  readonly tasks: ReturnType<typeof deriveThreadTaskList>;
}) {
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
  const tasks = props.tasks;
  if (!tasks) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${translator.message("mobile.timeline.tasks")}: ${translator.message("mobile.timeline.taskProgress", { done: tasks.completed, total: tasks.total })}`}
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        className="min-h-11 flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-1 active:opacity-70"
      >
        <SymbolView name="list.number" size={16} />
        <AppText numberOfLines={2} className="flex-1 text-sm text-foreground">
          {tasks.currentStep}
        </AppText>
        <AppText className="text-xs tabular-nums text-foreground-secondary">
          {tasks.completed}/{tasks.total}
        </AppText>
        <SymbolView name="chevron.right" size={12} />
      </Pressable>
      {open ? (
        // The steps open in a sheet: growing in place took the timeline's room above the keyboard.
        <ThreadDetailSheet
          title={translator.message("mobile.timeline.tasks")}
          onClose={() => setOpen(false)}
        >
          {tasks.steps.map((step) => (
            <View key={step.id} className="min-h-9 flex-row items-start gap-2 py-1.5">
              <View className="h-5 justify-center">
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
              </View>
              <AppText className="flex-1 text-sm text-foreground">{step.text}</AppText>
            </View>
          ))}
        </ThreadDetailSheet>
      ) : null}
    </>
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
    <View className="px-3 pb-2 pt-1.5">
      <ThreadTaskRow tasks={tasks} />
    </View>
  );
}
