import type { McpRuntimeAction, McpRuntimeState } from "@t3tools/contracts";
import {
  CopyIcon,
  Edit3Icon,
  EllipsisIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";

export type McpServerConfigurationAction = "edit" | "duplicate" | "delete";
export type McpServerRowAction = McpRuntimeAction | McpServerConfigurationAction;

export interface McpRuntimeActionPending {
  readonly serverKey: string;
  readonly action: McpRuntimeAction;
}

export interface McpServerRowActionDescriptor {
  readonly key: McpServerRowAction;
  readonly label: string;
  readonly destructive: boolean;
}

export interface McpServerRowActionModel {
  readonly primaryAction: McpServerRowActionDescriptor | null;
  readonly menuActions: ReadonlyArray<McpServerRowActionDescriptor>;
}

const ACTION_DESCRIPTOR: Readonly<Record<McpServerRowAction, McpServerRowActionDescriptor>> = {
  authorize: { key: "authorize", label: "Authorize", destructive: false },
  reconnect: { key: "reconnect", label: "Reconnect", destructive: false },
  refresh: { key: "refresh", label: "Refresh", destructive: false },
  edit: { key: "edit", label: "Edit", destructive: false },
  duplicate: { key: "duplicate", label: "Duplicate", destructive: false },
  delete: { key: "delete", label: "Delete", destructive: true },
};

const RECONNECT_PRIMARY_STATES: ReadonlySet<McpRuntimeState> = new Set([
  "failed",
  "stale",
  "not-started",
  "unknown",
]);

const RUNTIME_MENU_ORDER: ReadonlyArray<McpRuntimeAction> = ["refresh", "reconnect", "authorize"];

export function createMcpServerRowActionModel(input: {
  readonly state: McpRuntimeState;
  readonly availableRuntimeActions: ReadonlyArray<McpRuntimeAction>;
  readonly configurationActions?: ReadonlyArray<McpServerConfigurationAction>;
}): McpServerRowActionModel {
  const availableRuntimeActions = new Set(input.availableRuntimeActions);
  const primaryKey = selectPrimaryRuntimeAction(input.state, availableRuntimeActions);
  const menuActions = RUNTIME_MENU_ORDER.filter(
    (action) => availableRuntimeActions.has(action) && action !== primaryKey,
  )
    .map((action) => ACTION_DESCRIPTOR[action])
    .concat((input.configurationActions ?? []).map((action) => ACTION_DESCRIPTOR[action]));

  return {
    primaryAction: primaryKey === null ? null : ACTION_DESCRIPTOR[primaryKey],
    menuActions,
  };
}

function selectPrimaryRuntimeAction(
  state: McpRuntimeState,
  availableActions: ReadonlySet<McpRuntimeAction>,
): McpRuntimeAction | null {
  if (
    (state === "auth-required" || state === "setup-required") &&
    availableActions.has("authorize")
  ) {
    return "authorize";
  }
  if (RECONNECT_PRIMARY_STATES.has(state) && availableActions.has("reconnect")) {
    return "reconnect";
  }
  return null;
}

const ACTION_ICON = {
  authorize: KeyRoundIcon,
  reconnect: RotateCwIcon,
  refresh: RefreshCwIcon,
  edit: Edit3Icon,
  duplicate: CopyIcon,
  delete: Trash2Icon,
} satisfies Record<McpServerRowAction, typeof RefreshCwIcon>;

const PENDING_LABEL: Readonly<Record<McpRuntimeAction, string>> = {
  authorize: "Authorizing",
  reconnect: "Reconnecting",
  refresh: "Refreshing",
};

export interface McpServerRowControlsProps {
  readonly serverKey: string;
  readonly serverName: string;
  readonly state: McpRuntimeState;
  readonly availableRuntimeActions: ReadonlyArray<McpRuntimeAction>;
  readonly disabledRuntimeActions?: ReadonlyArray<McpRuntimeAction>;
  readonly pendingAction?: McpRuntimeActionPending | null;
  readonly readOnly: boolean;
  readonly providerAssignment?: {
    readonly enabled: boolean;
    readonly disabled: boolean;
    readonly pending: boolean;
    readonly onChange: (enabled: boolean) => void;
  };
  readonly onRuntimeAction?: (action: McpRuntimeAction) => void;
  readonly onEdit?: () => void;
  readonly onDuplicate?: () => void;
  readonly onDelete?: () => void;
}

export function McpServerRowControls(props: McpServerRowControlsProps) {
  const configurationActions = [
    props.onEdit ? ("edit" as const) : null,
    props.onDuplicate ? ("duplicate" as const) : null,
    props.onDelete ? ("delete" as const) : null,
  ].filter((action): action is McpServerConfigurationAction => action !== null);
  const model = createMcpServerRowActionModel({
    state: props.state,
    availableRuntimeActions: props.availableRuntimeActions,
    configurationActions,
  });
  const pendingAction =
    props.pendingAction?.serverKey === props.serverKey ? props.pendingAction.action : null;
  const rowPending = pendingAction !== null;
  const disabledRuntimeActions = new Set(props.disabledRuntimeActions);
  const primaryAction = model.primaryAction;
  const PrimaryIcon = primaryAction ? ACTION_ICON[primaryAction.key] : null;

  const runAction = (action: McpServerRowAction) => {
    if (action === "edit") {
      props.onEdit?.();
      return;
    }
    if (action === "duplicate") {
      props.onDuplicate?.();
      return;
    }
    if (action === "delete") {
      props.onDelete?.();
      return;
    }
    props.onRuntimeAction?.(action);
  };

  const actionDisabled = (action: McpServerRowAction): boolean => {
    if (props.readOnly || rowPending) return true;
    if (action === "edit") return props.onEdit === undefined;
    if (action === "duplicate") return props.onDuplicate === undefined;
    if (action === "delete") return props.onDelete === undefined;
    return disabledRuntimeActions.has(action) || props.onRuntimeAction === undefined;
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      {pendingAction ? (
        <span role="status" className="sr-only">
          {PENDING_LABEL[pendingAction]} {props.serverName}
        </span>
      ) : null}

      {primaryAction ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={actionDisabled(primaryAction.key)}
          title={props.readOnly ? "Runtime actions require operate access" : undefined}
          onClick={() => runAction(primaryAction.key)}
        >
          {pendingAction === primaryAction.key ? (
            <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
          ) : PrimaryIcon ? (
            <PrimaryIcon aria-hidden="true" className="size-3.5" />
          ) : null}
          {pendingAction === primaryAction.key
            ? `${PENDING_LABEL[pendingAction]}…`
            : primaryAction.label}
        </Button>
      ) : null}

      {props.providerAssignment ? (
        <label className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground">
          <span>Enabled</span>
          <Switch
            checked={props.providerAssignment.enabled}
            disabled={
              props.readOnly ||
              rowPending ||
              props.providerAssignment.disabled ||
              props.providerAssignment.pending
            }
            aria-label={`${props.providerAssignment.enabled ? "Disable" : "Enable"} ${props.serverName} for selected provider`}
            onCheckedChange={(enabled) => props.providerAssignment?.onChange(Boolean(enabled))}
          />
        </label>
      ) : null}

      {model.menuActions.length > 0 ? (
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Actions for ${props.serverName}`}
              />
            }
          >
            {pendingAction && primaryAction?.key !== pendingAction ? (
              <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <EllipsisIcon aria-hidden="true" className="size-4" />
            )}
          </MenuTrigger>
          <MenuPopup align="end" side="bottom" className="min-w-44">
            {model.menuActions.map((action) => {
              const Icon = ACTION_ICON[action.key];
              return (
                <MenuItem
                  key={action.key}
                  disabled={actionDisabled(action.key)}
                  variant={action.destructive ? "destructive" : "default"}
                  onClick={() => runAction(action.key)}
                >
                  <Icon aria-hidden="true" />
                  {pendingAction === action.key ? `${PENDING_LABEL[pendingAction]}…` : action.label}
                </MenuItem>
              );
            })}
          </MenuPopup>
        </Menu>
      ) : null}
    </div>
  );
}
