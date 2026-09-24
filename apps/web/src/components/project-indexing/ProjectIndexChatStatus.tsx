import { deriveProjectIndexChatStatus } from "@t3tools/client-runtime/project-indexing";
import { WaypointsIcon } from "lucide-react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const statusDotClasses = {
  active: "bg-primary",
  ready: "bg-success",
  attention: "bg-warning",
  idle: "bg-muted-foreground",
} as const;

const compactStateKeys = {
  discovering: "projectIndexing.compactState.discovering",
  extracting: "projectIndexing.compactState.extracting",
  resolving: "projectIndexing.compactState.resolving",
  analyzing: "projectIndexing.compactState.analyzing",
  "waiting-for-provider": "projectIndexing.compactState.waiting-for-provider",
  "waiting-for-resources": "projectIndexing.compactState.waiting-for-resources",
  updating: "projectIndexing.compactState.updating",
} as const;

export function ProjectIndexStatusChip(props: {
  readonly projectLabel: string;
  readonly status: NonNullable<ReturnType<typeof deriveProjectIndexChatStatus>>;
}) {
  const { message, number } = useInterfaceTranslator();
  const chatStatus = props.status;

  const stateLabel = message(`projectIndexing.state.${chatStatus.stage}`);
  const compactStateKey = compactStateKeys[chatStatus.stage as keyof typeof compactStateKeys];
  const compactStateLabel = compactStateKey ? message(compactStateKey) : stateLabel;
  const fileProgress =
    chatStatus.eligibleFiles > 0
      ? message("projectIndexing.chatFileProgress", {
          indexed: number(chatStatus.indexedFiles),
          eligible: number(chatStatus.eligibleFiles),
        })
      : null;
  const accessibleLabel = `${props.projectLabel} · ${message("projectIndexing.title")}: ${stateLabel}${fileProgress ? ` · ${fileProgress}` : ""}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={accessibleLabel}
            data-toolbar-status=""
            className="inline-flex h-7 max-w-56 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[var(--control-radius)] border border-input bg-popover px-[calc(--spacing(2)-1px)] text-xs font-medium text-foreground shadow-xs/5 dark:bg-input/32"
          />
        }
      >
        <WaypointsIcon aria-hidden className="size-3.5 shrink-0" />
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${statusDotClasses[chatStatus.tone]}`}
        />
        <span className="max-w-24 truncate">{compactStateLabel}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{accessibleLabel}</TooltipPopup>
    </Tooltip>
  );
}
