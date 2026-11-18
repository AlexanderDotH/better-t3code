import { useState } from "react";
import { formatTokens } from "@t3tools/shared/usageFormat";
import type { MergedUsage, ProjectTotals } from "@t3tools/shared/usageMerge";

import { cn } from "../../lib/utils";
import { type UsageChartWindow } from "./UsageModelDialog";
import { UsageProviderChart } from "./UsageProviderChart";
import { PROVIDER_PRESENTATION } from "./usageProviders";
import { sortModelsByTokens } from "./usageBreakdown";

export function UsageProjects({
  usage,
  chartWindow,
  readProject,
}: {
  readonly usage: MergedUsage;
  readonly chartWindow: UsageChartWindow;
  readonly readProject: (project: ProjectTotals) => MergedUsage;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const project = usage.projects.find((entry) => entry.key === selectedKey) ?? usage.projects[0];
  const detail = project === undefined ? null : readProject(project);
  const showEnvironment = new Set(usage.projects.map((entry) => entry.environmentId)).size > 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-1">
        {usage.projects.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No usage linked to a project in this window.
          </p>
        ) : null}
        {usage.projects.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={entry.key === project?.key}
            onClick={() => setSelectedKey(entry.key)}
            className={cn(
              "min-w-0 rounded-md px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring",
              entry.key === project?.key && "bg-muted",
            )}
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words text-sm font-medium">{entry.title}</span>
              <span className="shrink-0 text-xs tabular-nums">
                {formatTokens(entry.totalTokens)}
              </span>
            </span>
            {showEnvironment ? (
              <span className="block truncate text-xs text-muted-foreground">
                {entry.environmentLabel}
              </span>
            ) : null}
            <span aria-hidden className="mt-2 block h-0.5 rounded-full bg-border">
              <span
                className="block h-full rounded-full bg-foreground/50"
                style={{ width: `${(entry.totalTokens / Math.max(1, usage.totalTokens)) * 100}%` }}
              />
            </span>
          </button>
        ))}
        {usage.unassignedProjectTokens > 0 ? (
          <p className="flex justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
            <span>Unassigned tokens</span>
            <span className="tabular-nums">{formatTokens(usage.unassignedProjectTokens)}</span>
          </p>
        ) : null}
      </div>
      {detail === null ? null : (
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-medium">
            {chartWindow.resolution === "hour" ? "Hourly" : "Daily"} project tokens
          </h3>
          <UsageProviderChart
            {...chartWindow}
            providers={[...new Set(detail.models.map((model) => model.provider))]}
            daily={detail.daily}
            hourly={detail.hourly}
            metric="tokens"
          />
          <ul aria-label="Project tokens by model" className="divide-y divide-border/50">
            {sortModelsByTokens(detail.models).map((model) => (
              <li
                key={`${model.provider}:${model.model}`}
                className="flex items-baseline justify-between gap-3 py-2 text-sm"
              >
                <span className="min-w-0 break-words">
                  {model.model}{" "}
                  <span className="text-xs text-muted-foreground">
                    {PROVIDER_PRESENTATION[model.provider].label}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatTokens(model.totalTokens)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
