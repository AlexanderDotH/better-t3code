import { Fragment, isValidElement, useMemo, type ReactNode } from "react";
import { markdownCodeBlocks } from "./markdownCodeBlocks";
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
  const blocks = useMemo(
    () => (props.renderCodeBlock ? markdownCodeBlocks(props.markdown) : []),
    [props.markdown, props.renderCodeBlock],
  );
  if (!props.renderCodeBlock || blocks.length === 0)
    return <MobileEnrichedMarkdownText {...props} textStyle={textStyle} />;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const block of blocks) {
    const rendered = props.renderCodeBlock(block.request);
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
    parts.push(<Fragment key={`code:${block.start}`}>{rendered}</Fragment>);
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
