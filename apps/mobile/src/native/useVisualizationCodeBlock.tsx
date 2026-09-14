import { useAtomValue } from "@effect/atom-react";
import { resolveBetterT3FeatureFlag, type EnvironmentId } from "@t3tools/contracts";
import { normalizeVisualizationFormat } from "@t3tools/client-runtime/visualizations/model";
import type { MarkdownCodeBlockRenderer } from "@t3tools/mobile-markdown-text/types";
import { useCallback, useMemo } from "react";

import { VisualizationBlock } from "../features/visualizations/VisualizationBlock";
import { serverEnvironment } from "../state/server";
import { isClosedNativeVisualization } from "./nativeVisualization";

export function useVisualizationCodeBlock(
  environmentId: EnvironmentId,
  markdown: string,
  onAction?: ((prompt: string) => void) | undefined,
): MarkdownCodeBlockRenderer | undefined {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const enabled =
    config?.environment.capabilities.visualizationsVersion === 1 &&
    resolveBetterT3FeatureFlag(config.settings.betterT3Environment, "chat.visualizations");
  const source = useMemo(
    () => (enabled ? new TextEncoder().encode(markdown) : null),
    [enabled, markdown],
  );
  const render = useCallback<MarkdownCodeBlockRenderer>(
    (block) => {
      const format = normalizeVisualizationFormat(block.language);
      if (!source || !format || !isClosedNativeVisualization(source, block)) return null;
      return <VisualizationBlock language={format} code={block.code} onAction={onAction} />;
    },
    [onAction, source],
  );
  return enabled ? render : undefined;
}
