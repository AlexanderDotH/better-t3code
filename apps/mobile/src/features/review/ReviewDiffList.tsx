import { useMemo, useRef, useEffect } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import type { ReviewRenderableFile, ReviewRenderableLineRow } from "./reviewModel";
import type { NativeReviewDiffData } from "./nativeReviewDiffAdapter";
import { filterWhitespaceRows, splitReviewRows } from "./review-preferences";
import { useAppearanceCodeSurface } from "../settings/appearance/useAppearanceCodeSurface";

const FILE_HEADER_HEIGHT = 80;
const HUNK_HEADER_HEIGHT = 32;

export function ReviewDiffList(props: {
  readonly files: ReadonlyArray<ReviewRenderableFile>;
  readonly data: NativeReviewDiffData;
  readonly split: boolean;
  readonly ignoreWhitespace: boolean;
  readonly blueOrange: boolean;
  readonly collapsedFileIds: ReadonlyArray<string>;
  readonly targetFile?: string;
  readonly insetTop: number;
  readonly insetBottom: number;
  readonly onToggleFile: (id: string) => void;
  readonly onPressLine: (rowId: string, gesture: "tap" | "longPress") => void;
  readonly onVisibleFile: (id: string) => void;
}) {
  const list = useRef<FlatList>(null);
  const { codeSurface } = useAppearanceCodeSurface();
  const lineHeight = codeSurface.rowHeight + 8;
  const rows = useMemo(
    () =>
      props.files.flatMap((file) => {
        const header = {
          id: `${file.id}:header`,
          file,
          header: file.path,
          left: null,
          right: null,
          isFile: true,
        };
        if (props.collapsedFileIds.includes(file.id)) return [header];
        const visible = filterWhitespaceRows(file.rows, props.ignoreWhitespace);
        const body = props.split
          ? splitReviewRows(visible)
          : visible.map((row) => ({
              id: row.id,
              ...(row.kind === "hunk" ? { header: row.header } : {}),
              left: row.kind === "line" ? row : null,
              right: null,
            }));
        return [header, ...body.map((row) => ({ ...row, file, isFile: false }))];
      }),
    [props.files, props.collapsedFileIds, props.split, props.ignoreWhitespace],
  );
  const targetIndex = props.targetFile
    ? rows.findIndex(
        (row) =>
          row.isFile &&
          (row.file.id === props.targetFile ||
            row.file.path === props.targetFile ||
            row.file.previousPath === props.targetFile),
      )
    : -1;
  const layouts = useMemo(() => {
    const measured: Array<{
      readonly index: number;
      readonly length: number;
      readonly offset: number;
    }> = [];
    for (const [index, row] of rows.entries()) {
      const length = row.isFile ? FILE_HEADER_HEIGHT : row.header ? HUNK_HEADER_HEIGHT : lineHeight;
      const previous = measured[index - 1];
      measured.push({
        index,
        length,
        offset: previous ? previous.offset + previous.length : props.insetTop,
      });
    }
    return measured;
  }, [rows, lineHeight, props.insetTop]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Scroll the virtual list when a route opens a specific file.
  useEffect(() => {
    if (targetIndex >= 0)
      list.current?.scrollToIndex({ index: targetIndex, animated: false, viewPosition: 0 });
  }, [targetIndex]);
  const renderLine = (line: ReviewRenderableLineRow | null, side: "left" | "right") => {
    const rowId = line ? props.data.rowIdByCommentLineId.get(line.id) : undefined;
    const tint =
      line?.change === "add"
        ? props.blueOrange
          ? "bg-blue-500/10"
          : "bg-emerald-500/10"
        : line?.change === "delete"
          ? props.blueOrange
            ? "bg-orange-500/10"
            : "bg-rose-500/10"
          : "";
    return (
      <Pressable
        accessibilityRole="button"
        disabled={!rowId}
        onPress={() => rowId && props.onPressLine(rowId, "tap")}
        onLongPress={() => rowId && props.onPressLine(rowId, "longPress")}
        className={`min-w-0 flex-1 flex-row gap-2 px-2 py-1 ${tint}`}
      >
        <AppText className="w-10 text-right font-mono text-xs text-foreground-muted">
          {side === "left"
            ? (line?.oldLineNumber ?? line?.newLineNumber ?? "")
            : (line?.newLineNumber ?? "")}
        </AppText>
        <ScrollView horizontal bounces={false} className="min-w-0 flex-1">
          <AppText
            className="font-mono text-foreground"
            style={{ fontSize: codeSurface.fontSize, lineHeight: codeSurface.rowHeight }}
          >
            {line?.content ?? " "}
          </AppText>
        </ScrollView>
      </Pressable>
    );
  };
  return (
    <FlatList
      ref={list}
      data={rows}
      keyExtractor={(row) => row.id}
      getItemLayout={(_data, index) => layouts[index]!}
      contentContainerStyle={{ paddingTop: props.insetTop, paddingBottom: props.insetBottom }}
      onViewableItemsChanged={({ viewableItems }) => {
        const first = viewableItems[0]?.item;
        if (first) props.onVisibleFile(first.file.id);
      }}
      renderItem={({ item }) =>
        item.isFile ? (
          <Pressable
            accessibilityRole="button"
            className="border-b border-border bg-card px-4 py-3"
            style={{ height: FILE_HEADER_HEIGHT }}
            onPress={() => props.onToggleFile(item.file.id)}
          >
            <AppText numberOfLines={1} className="text-sm font-t3-semibold text-foreground">
              {item.header}
            </AppText>
            <AppText className="text-xs text-foreground-muted">
              +{item.file.additions} −{item.file.deletions}
            </AppText>
            {item.file.notice ? (
              <AppText numberOfLines={1} className="text-xs text-foreground-muted">
                {item.file.notice}
              </AppText>
            ) : null}
          </Pressable>
        ) : item.header ? (
          <View className="bg-subtle px-3 py-2" style={{ height: HUNK_HEADER_HEIGHT }}>
            <AppText numberOfLines={1} className="font-mono text-xs text-foreground-muted">
              {item.header}
            </AppText>
          </View>
        ) : (
          <View className="flex-row" style={{ height: lineHeight }}>
            {renderLine(item.left, "left")}
            {props.split ? renderLine(item.right, "right") : null}
          </View>
        )
      }
    />
  );
}
