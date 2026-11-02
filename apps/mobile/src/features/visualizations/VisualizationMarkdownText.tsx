import type { EnvironmentId } from "@t3tools/contracts";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import type { SelectableMarkdownTextProps } from "../../native/SelectableMarkdownText.types";
import { useVisualizationCodeBlock } from "./useVisualizationCodeBlock";

export function VisualizationMarkdownText({
  environmentId,
  onAction,
  ...props
}: SelectableMarkdownTextProps & {
  readonly environmentId: EnvironmentId;
  readonly onAction?: (prompt: string) => void;
}) {
  const renderCodeBlock = useVisualizationCodeBlock(environmentId, props.markdown, onAction);
  return <SelectableMarkdownText {...props} renderCodeBlock={renderCodeBlock} />;
}
