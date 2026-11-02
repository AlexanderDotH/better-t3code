import { useStableCallback } from "../../hooks/useStableCallback";
import {
  BETTER_T3_SETTINGS_SUBGROUPS,
  getBetterT3SettingsSubgroupForTarget,
  sanitizeBetterT3ExpandedSettingsGroups,
  type BetterT3SettingsSubgroupId,
} from "@t3tools/client-runtime/better-t3-settings-layout";
import * as Schema from "effect/Schema";
import { ChevronRightIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import {
  getLocalStorageItem,
  setLocalStorageItem,
  useLocalStorage,
} from "../../hooks/useLocalStorage";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { useRetrySettingsSearchTarget, useSettingsSearchTargetId } from "./settingsLayout";

const EXPANDED_GROUPS_STORAGE_KEY = "t3code.better-t3-settings-expanded.v1";
const EMPTY_EXPANDED_GROUPS: ReadonlyArray<BetterT3SettingsSubgroupId> = [];
let sessionExpandedGroups: ReadonlyArray<BetterT3SettingsSubgroupId> | null = null;

interface BetterT3SettingsExpansion {
  readonly isExpanded: (groupId: BetterT3SettingsSubgroupId) => boolean;
  readonly setExpanded: (groupId: BetterT3SettingsSubgroupId, expanded: boolean) => void;
  readonly openForTarget: (targetId: string) => boolean;
}

const BetterT3SettingsExpansionContext = createContext<BetterT3SettingsExpansion | null>(null);

export function BetterT3SettingsExpansionProvider({ children }: { readonly children: ReactNode }) {
  const [storedGroups, storeGroups] = useLocalStorage(
    EXPANDED_GROUPS_STORAGE_KEY,
    EMPTY_EXPANDED_GROUPS,
    Schema.Unknown,
  );
  const [expandedGroups, setExpandedGroups] = useState<ReadonlyArray<BetterT3SettingsSubgroupId>>(
    () => sessionExpandedGroups ?? sanitizeBetterT3ExpandedSettingsGroups(storedGroups),
  );
  const expandedGroupsRef = useRef(expandedGroups);
  const setExpanded = useStableCallback(
    (groupId: BetterT3SettingsSubgroupId, expanded: boolean) => {
      const current = expandedGroupsRef.current;
      if (current.includes(groupId) === expanded) return;
      const next = sanitizeBetterT3ExpandedSettingsGroups(
        expanded ? [...current, groupId] : current.filter((id) => id !== groupId),
      );
      expandedGroupsRef.current = next;
      setExpandedGroups(next);
      try {
        // Repair malformed JSON before the shared hook reads the previous value for its update.
        setLocalStorageItem(EXPANDED_GROUPS_STORAGE_KEY, next, Schema.Unknown);
        storeGroups(next);
        const persisted = getLocalStorageItem(EXPANDED_GROUPS_STORAGE_KEY, Schema.Unknown);
        sessionExpandedGroups = JSON.stringify(persisted) === JSON.stringify(next) ? null : next;
      } catch {
        sessionExpandedGroups = next;
      }
    },
  );
  const openForTarget = useStableCallback((targetId: string) => {
    const group = getBetterT3SettingsSubgroupForTarget(targetId);
    if (!group?.collapsible) return false;
    setExpanded(group.id, true);
    return true;
  });
  const value = {
    isExpanded: (groupId: BetterT3SettingsSubgroupId) => expandedGroups.includes(groupId),
    setExpanded,
    openForTarget,
  };
  return (
    <BetterT3SettingsExpansionContext value={value}>{children}</BetterT3SettingsExpansionContext>
  );
}

export function useBetterT3SettingsExpansion() {
  return useContext(BetterT3SettingsExpansionContext);
}

interface BetterT3SettingsSubgroupProps {
  readonly groupId: BetterT3SettingsSubgroupId;
  readonly title?: string;
  readonly summary?: ReactNode;
  readonly hideTitle?: boolean;
  readonly revealOnError?: boolean;
  readonly children: ReactNode;
}

export function BetterT3SettingsSubgroup(props: BetterT3SettingsSubgroupProps) {
  const expansion = useBetterT3SettingsExpansion();
  return expansion ? (
    <BetterT3SettingsSubgroupContent {...props} expansion={expansion} />
  ) : (
    <BetterT3SettingsExpansionProvider>
      <BetterT3SettingsSubgroup {...props} />
    </BetterT3SettingsExpansionProvider>
  );
}

function BetterT3SettingsSubgroupContent({
  groupId,
  title,
  summary,
  hideTitle = false,
  revealOnError = false,
  children,
  expansion,
}: BetterT3SettingsSubgroupProps & { readonly expansion: BetterT3SettingsExpansion }) {
  const translator = useInterfaceTranslator();
  const group = BETTER_T3_SETTINGS_SUBGROUPS.find((candidate) => candidate.id === groupId);
  const targetId = useSettingsSearchTargetId();
  const [reveal, setReveal] = useState({
    targetId,
    error: revealOnError,
    expanded:
      revealOnError ||
      (targetId !== null && getBetterT3SettingsSubgroupForTarget(targetId)?.id === groupId),
  });
  if (reveal.targetId !== targetId || reveal.error !== revealOnError) {
    setReveal({
      targetId,
      error: revealOnError,
      expanded:
        reveal.expanded ||
        (targetId !== null && getBetterT3SettingsSubgroupForTarget(targetId)?.id === groupId) ||
        (!reveal.error && revealOnError),
    });
  }
  const searchMatch =
    targetId !== null && getBetterT3SettingsSubgroupForTarget(targetId)?.id === groupId;
  const expanded =
    !group?.collapsible || expansion.isExpanded(groupId) || reveal.expanded || searchMatch;
  const [wasExpanded, setWasExpanded] = useState(expanded);
  if (expanded && !wasExpanded) setWasExpanded(true);
  const setExpanded = useStableCallback((next: boolean) => {
    setReveal({ targetId, error: revealOnError, expanded: false });
    expansion.setExpanded(groupId, next);
  });
  const retryTarget = useRetrySettingsSearchTarget();
  const mountedExpandedContent = useRef(false);
  const id = useId();
  const headingId = `${id}-heading`;
  const panelId = `${id}-panel`;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Persist search and validation reveals to browser storage so returning to settings keeps the subgroup open.
  useLayoutEffect(() => {
    if (!group?.collapsible || !reveal.expanded || expansion.isExpanded(groupId)) return;
    expansion.setExpanded(groupId, true);
  }, [expansion, group?.collapsible, groupId, reveal.expanded]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retries DOM search-target focus after a collapsed section mounts its content
  useLayoutEffect(() => {
    if (!group?.collapsible || !expanded) return;
    if (mountedExpandedContent.current) retryTarget();
    mountedExpandedContent.current = true;
  }, [expanded, group?.collapsible, retryTarget]);

  const label = title ?? (group ? translator.message(group.titleMessageId) : groupId);
  const body = (
    <div className="ml-3 border-l border-border/60 sm:ml-4 [&>[data-slot=settings-row]+[data-slot=settings-row]]:border-t [&>[data-slot=settings-row]+[data-slot=settings-row]]:border-border/40">
      {children}
    </div>
  );

  if (!group?.collapsible) {
    return (
      <div data-better-t3-subgroup={groupId} className="py-1.5">
        {!hideTitle ? (
          <h3 className="px-3 py-1.5 text-xs font-medium text-muted-foreground sm:px-4">{label}</h3>
        ) : null}
        {body}
      </div>
    );
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      data-better-t3-subgroup={groupId}
      onInvalidCapture={() => setExpanded(true)}
    >
      <h3 id={headingId}>
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 sm:px-4 [@media(pointer:coarse)]:min-h-11"
            />
          }
          aria-controls={panelId}
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={expanded ? "size-3.5 shrink-0 rotate-90" : "size-3.5 shrink-0"}
          />
          <span className="min-w-0 flex-1 font-medium">{label}</span>
          {summary ? (
            <span className="max-w-[60%] text-right text-xs text-muted-foreground">{summary}</span>
          ) : null}
        </CollapsibleTrigger>
      </h3>
      {wasExpanded ? (
        <CollapsiblePanel
          keepMounted
          id={panelId}
          aria-labelledby={headingId}
          inert={!expanded}
          aria-hidden={!expanded}
        >
          {body}
        </CollapsiblePanel>
      ) : null}
    </Collapsible>
  );
}
