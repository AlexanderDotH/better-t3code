import { findErrorTraceId } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { ServerIcon } from "lucide-react";
import { useRef, useState } from "react";

import {
  deregisterManagedRelayEnvironmentCommand,
  useManagedRelayEnvironments,
} from "../../cloud/managedRelayState";
import { useAtomCommand } from "../../state/use-atom-command";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { toastManager } from "../ui/toast";
import {
  ClerkUserProfilePage,
  ClerkUserProfileRefreshButton,
  ClerkUserProfileRow,
} from "./ClerkUserProfilePage";

function linkedAtLabel(value: string, translator: InterfaceTranslator): string {
  const linkedAt = new Date(value);
  return Number.isNaN(linkedAt.getTime())
    ? translator.message("t3Connect.linkDateUnavailable")
    : translator.message("t3Connect.linkedAt", { date: translator.date(linkedAt) });
}

function endpointLabel(
  environment: RelayClientEnvironmentRecord,
  translator: InterfaceTranslator,
): string {
  return environment.endpoint.providerKind === "cloudflare_tunnel"
    ? translator.message("t3Connect.endpoint.managedTunnel")
    : translator.message("t3Connect.endpoint.activityOnly");
}

export function T3ConnectEnvironmentRow(props: {
  readonly environment: RelayClientEnvironmentRecord;
  readonly confirmationOpen: boolean;
  readonly mutationPending: boolean;
  readonly onConfirmationChange: (open: boolean) => void;
  readonly onDeregister: (environment: RelayClientEnvironmentRecord) => void;
}) {
  const { environment } = props;
  const translator = useInterfaceTranslator();
  return (
    <ClerkUserProfileRow icon={<ServerIcon className="size-4" />}>
      <Collapsible open={props.confirmationOpen} onOpenChange={props.onConfirmationChange}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[0.8125rem] leading-[1.125rem] font-medium text-foreground">
              {environment.label}
            </h3>
            <p className="mt-1 text-xs leading-[1.125rem] text-muted-foreground">
              {linkedAtLabel(environment.linkedAt, translator)} ·{" "}
              {endpointLabel(environment, translator)}
            </p>
          </div>
          <CollapsibleTrigger
            render={
              <Button
                size="sm"
                variant="destructive-outline"
                className="text-[0.8125rem]"
                disabled={props.mutationPending}
              >
                {translator.message("t3Connect.deregister.action")}
              </Button>
            }
          />
        </div>

        <CollapsiblePanel>
          <div className="pt-3">
            <div
              className="rounded-lg border border-input bg-muted/32 px-5 py-4 shadow-xs/5"
              role="group"
              aria-label={translator.message("t3Connect.deregister.confirmAria", {
                environment: environment.label,
              })}
            >
              <h4 className="text-[0.8125rem] leading-[1.125rem] font-semibold text-foreground">
                {translator.message("t3Connect.deregister.title")}
              </h4>
              <p className="mt-1 text-[0.8125rem] leading-[1.125rem] text-muted-foreground">
                {translator.message("t3Connect.deregister.confirmDescription", {
                  environment: environment.label,
                })}
              </p>
              <p className="mt-4 max-w-xl text-[0.8125rem] leading-[1.125rem] text-muted-foreground">
                {translator.message("t3Connect.deregister.consequences")}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[0.8125rem]"
                  disabled={props.mutationPending}
                  onClick={() => props.onConfirmationChange(false)}
                >
                  {translator.message("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="text-[0.8125rem]"
                  disabled={props.mutationPending}
                  onClick={() => props.onDeregister(environment)}
                >
                  {translator.message(
                    props.mutationPending
                      ? "t3Connect.deregister.pending"
                      : "t3Connect.deregister.action",
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </ClerkUserProfileRow>
  );
}

export function T3ConnectUserProfilePage() {
  const translator = useInterfaceTranslator();
  const environmentsState = useManagedRelayEnvironments();
  const deregisterEnvironment = useAtomCommand(deregisterManagedRelayEnvironmentCommand, {
    reportFailure: false,
  });
  const [deregisteringEnvironmentId, setDeregisteringEnvironmentId] =
    useState<EnvironmentId | null>(null);
  const [confirmingEnvironmentId, setConfirmingEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  const mutationPendingRef = useRef(false);
  const [removedEnvironments, setRemovedEnvironments] = useState<{
    readonly accountId: string | null;
    readonly linkedAtById: ReadonlyMap<EnvironmentId, string>;
  }>({ accountId: null, linkedAtById: new Map() });

  const handleDeregister = async (environment: RelayClientEnvironmentRecord) => {
    const accountId = environmentsState.accountId;
    if (!accountId || mutationPendingRef.current) return;

    mutationPendingRef.current = true;
    setDeregisteringEnvironmentId(environment.environmentId);
    const result = await deregisterEnvironment({
      accountId,
      environmentId: environment.environmentId,
    });
    mutationPendingRef.current = false;
    setDeregisteringEnvironmentId(null);

    if (result._tag === "Success") {
      setConfirmingEnvironmentId(null);
      setRemovedEnvironments((current) => {
        const linkedAtById = new Map(current.accountId === accountId ? current.linkedAtById : []);
        linkedAtById.set(environment.environmentId, environment.linkedAt);
        return { accountId, linkedAtById };
      });
      environmentsState.refresh();
      toastManager.add({
        type: "success",
        title: translator.message("t3Connect.deregister.successTitle"),
        description: translator.message("t3Connect.deregister.successDescription"),
      });
      return;
    }
    if (isAtomCommandInterrupted(result)) return;

    const cause = squashAtomCommandFailure(result);
    const message =
      cause instanceof Error
        ? cause.message
        : translator.message("t3Connect.deregister.failureFallback");
    const traceId = findErrorTraceId(cause);
    console.error("[t3-connect] Could not deregister environment", {
      environmentId: environment.environmentId,
      message,
      traceId,
      cause,
    });
    toastManager.add({
      type: "error",
      title: translator.message("t3Connect.deregister.failureTitle"),
      description: message,
      data: traceId
        ? {
            secondaryActionProps: {
              children: translator.message("cloud.action.copyTraceId"),
              onClick: () => void navigator.clipboard?.writeText(traceId),
            },
          }
        : undefined,
    });
  };

  const removedEnvironmentLinkedAt =
    removedEnvironments.accountId === environmentsState.accountId
      ? removedEnvironments.linkedAtById
      : new Map<EnvironmentId, string>();
  const environments = (environmentsState.data ?? []).filter(
    (environment) =>
      removedEnvironmentLinkedAt.get(environment.environmentId) !== environment.linkedAt,
  );
  const isInitialLoad =
    !environmentsState.accountId || (environmentsState.data === null && !environmentsState.error);

  return (
    <ClerkUserProfilePage
      title={translator.message("t3Connect.label")}
      description={translator.message("t3Connect.profile.description")}
      action={
        <ClerkUserProfileRefreshButton
          disabled={deregisteringEnvironmentId !== null}
          isPending={environmentsState.isPending}
          onClick={environmentsState.refresh}
        />
      }
    >
      <div>
        {environmentsState.error ? (
          <div className="mb-4 border-t border-destructive/35 py-3 text-[0.8125rem]" role="alert">
            <p className="font-medium text-destructive-foreground">
              {translator.message("t3Connect.loadFailed")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{environmentsState.error}</p>
          </div>
        ) : null}

        {isInitialLoad ? (
          <p className="border-t py-4 text-[0.8125rem] text-muted-foreground" role="status">
            {translator.message("t3Connect.loading")}
          </p>
        ) : environments.length > 0 ? (
          <ul className="border-t">
            {environments.map((environment) => (
              <T3ConnectEnvironmentRow
                key={environment.environmentId}
                environment={environment}
                confirmationOpen={confirmingEnvironmentId === environment.environmentId}
                mutationPending={deregisteringEnvironmentId !== null}
                onConfirmationChange={(open) =>
                  setConfirmingEnvironmentId(open ? environment.environmentId : null)
                }
                onDeregister={(selected) => void handleDeregister(selected)}
              />
            ))}
          </ul>
        ) : environmentsState.error ? null : (
          <Empty className="min-h-64 gap-4 border-t px-6 py-10 md:p-10">
            <EmptyMedia className="mb-0" variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle className="text-[1.0625rem] leading-6">
                {translator.message("t3Connect.empty.title")}
              </EmptyTitle>
              <EmptyDescription className="text-[0.8125rem] leading-[1.125rem]">
                {translator.message("t3Connect.empty.description")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </ClerkUserProfilePage>
  );
}
