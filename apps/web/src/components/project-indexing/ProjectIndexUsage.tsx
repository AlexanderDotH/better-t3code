import type { ProjectIndexUsageV1 } from "@t3tools/contracts";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

export function ProjectIndexUsage({ usage }: { readonly usage: ProjectIndexUsageV1 }) {
  const { message, number } = useInterfaceTranslator();
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {message(`projectIndexing.usage.${usage.usageStatus}`)}
      {usage.inputTokens !== undefined
        ? ` · ${message("projectIndexing.inputTokens", { count: number(usage.inputTokens) })}`
        : ""}
      {usage.outputTokens !== undefined
        ? ` · ${message("projectIndexing.outputTokens", { count: number(usage.outputTokens) })}`
        : ""}
      {` · ${message("projectIndexing.requests", { count: number(usage.requests) })}`}
    </p>
  );
}
