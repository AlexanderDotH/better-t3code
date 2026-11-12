import type { GitChangeSelection, GitChangesDiffResult } from "@t3tools/contracts";
import { LegendList } from "@legendapp/list/react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import { toggleChangeSelection } from "./git-workbench-model";
import { WorkbenchButton } from "./WorkbenchControls";

export function GitPatchView(props: {
  readonly diff: GitChangesDiffResult;
  readonly selection: GitChangeSelection;
  readonly onSelectionChange: (selection: GitChangeSelection) => void;
  readonly allowPartial?: boolean;
}) {
  const t = useMobileInterfaceTranslator();
  const rows = useMemo(
    () =>
      props.diff.hunks.flatMap((hunk) => [
        { kind: "hunk" as const, id: hunk.id, hunk },
        ...hunk.lines.map((line) => ({ kind: "line" as const, id: line.id, line })),
      ]),
    [props.diff.hunks],
  );
  const partialDisabled =
    props.diff.binary ||
    props.diff.truncated ||
    props.diff.oldPath !== undefined ||
    props.allowPartial === false;
  return (
    <View className="gap-2">
      <WorkbenchButton
        selected={props.selection.kind === "file"}
        label={t.message("mobile.gitParity.entireFile")}
        onPress={() => props.onSelectionChange({ kind: "file" })}
      />
      {props.diff.binary ? (
        <AppText>{t.message("mobile.git.binaryFile")}</AppText>
      ) : (
        // oxlint-disable-next-line t3code/require-registered-list-scroll -- The outer sheet owns header scrolling; this list only scrolls the patch.
        <LegendList
          recycleItems={false}
          data={rows}
          keyExtractor={(row) => row.id}
          estimatedItemSize={28}
          getItemType={(row) => row.kind}
          nestedScrollEnabled
          style={{ height: Math.min(480, Math.max(100, rows.length * 28)) }}
          renderItem={({ item }) => {
            const selectable =
              !partialDisabled &&
              (item.kind === "hunk"
                ? item.hunk.lines.some((line) => line.selectable)
                : item.line.selectable);
            const kind = item.kind === "hunk" ? "hunks" : "lines";
            const selected = props.selection.kind === kind && props.selection.ids.includes(item.id);
            return (
              <Pressable
                disabled={!selectable}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected, disabled: !selectable }}
                accessibilityLabel={
                  item.kind === "hunk"
                    ? item.hunk.header
                    : `${item.line.oldLine ?? ""} ${item.line.newLine ?? ""} ${item.line.content}`
                }
                onPress={() =>
                  props.onSelectionChange(toggleChangeSelection(props.selection, kind, item.id))
                }
                className={selected ? "bg-primary/15 px-2 py-1" : "px-2 py-1"}
              >
                <AppText
                  selectable={!selectable}
                  className={
                    item.kind === "hunk"
                      ? "font-mono text-xs text-foreground-muted"
                      : item.line.type === "addition"
                        ? "font-mono text-xs text-green-600"
                        : item.line.type === "deletion"
                          ? "font-mono text-xs text-red-500"
                          : "font-mono text-xs text-foreground"
                  }
                >
                  {item.kind === "hunk"
                    ? item.hunk.header
                    : `${item.line.type === "addition" ? "+" : item.line.type === "deletion" ? "−" : " "}${item.line.content}`}
                </AppText>
              </Pressable>
            );
          }}
        />
      )}
      {props.diff.truncated ? (
        <AppText className="text-xs text-amber-600">{t.message("git.diff.patchTruncated")}</AppText>
      ) : null}
      {props.selection.kind !== "file" ? (
        <AppText className="text-xs text-foreground-muted">
          {t.message("mobile.gitParity.selectionCount", { count: props.selection.ids.length })}
        </AppText>
      ) : null}
    </View>
  );
}
