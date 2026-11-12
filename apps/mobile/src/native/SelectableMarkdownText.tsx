import { Fragment, isValidElement, useMemo, type ReactNode } from "react";
import { markdownActionBlocks } from "./markdownActionBlocks";
import { MarkdownTableActions, MarkdownTerminalAction } from "./MarkdownBlockActions";
import { Platform } from "react-native";
import type { SelectableMarkdownTextProps } from "./SelectableMarkdownText.types";

import { MobileEnrichedMarkdownText } from "./EnrichedMarkdownText";
import { themeColorWithAlpha } from "../lib/mobileTheme";
import { useUniwindTheme } from "../lib/useUniwindTheme";

export type {
  MarkdownCodeBlockRenderer,
  MarkdownCodeBlockRequest,
  MarkdownFileContextMenu,
  MarkdownFileContextMenuAction,
  MarkdownImageRenderer,
  MarkdownImageRequest,
  MarkdownImageSourceResolver,
  MarkdownLinkCustomization,
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
} from "./SelectableMarkdownText.types";

export function SelectableMarkdownText(props: SelectableMarkdownTextProps) {
  const theme = useUniwindTheme();
  const selectionColor = themeColorWithAlpha(theme["--color-focus"], 0.32);
  const selectionHandleColor = theme["--color-focus"];
  const textStyle =
    Platform.OS === "android"
      ? { selectionColor, selectionHandleColor, ...props.textStyle }
      : props.textStyle;
  const blocks = useMemo(() => markdownActionBlocks(props.markdown), [props.markdown]);
  if (blocks.length === 0) return <MobileEnrichedMarkdownText {...props} textStyle={textStyle} />;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const block of blocks) {
    const rendered =
      block.kind === "table" ? (
        <MarkdownTableActions
          markdown={block.markdown}
          csv={block.csv}
          textProps={{ ...props, textStyle }}
        />
      ) : (
        (props.renderCodeBlock?.(block.request) ??
        (props.onRunCommand && block.runnable ? (
          <MarkdownTerminalAction
            markdown={block.markdown}
            command={block.request.code.trim()}
            textProps={{ ...props, textStyle }}
          />
        ) : null))
      );
    if (!isValidElement(rendered)) continue;
    if (block.start > offset)
      parts.push(
        <MobileEnrichedMarkdownText
          key={`text:${offset}`}
          {...props}
          markdown={props.markdown.slice(offset, block.start)}
          textStyle={textStyle}
        />,
      );
    parts.push(<Fragment key={`block:${block.start}`}>{rendered}</Fragment>);
    offset = block.end;
  }
  if (offset === 0) return <MobileEnrichedMarkdownText {...props} textStyle={textStyle} />;
  if (offset < props.markdown.length)
    parts.push(
      <MobileEnrichedMarkdownText
        key={`text:${offset}`}
        {...props}
        markdown={props.markdown.slice(offset)}
        textStyle={textStyle}
      />,
    );
  return <>{parts}</>;
}
