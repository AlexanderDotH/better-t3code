"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import type { ProviderAuthConnectEvent } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import type { ProviderAuthFlow } from "./ProviderSettingsPanel.logic";
import {
  reduceProviderAuthDialogState,
  toProviderAuthDialogEvent,
  type ProviderAuthDialogState,
  type ProviderSubscriptionPresentation,
} from "./ProviderSubscriptionAuth";

export interface ProviderSubscriptionAuthController {
  readonly flow: ProviderAuthFlow;
  readonly event: ProviderAuthConnectEvent | null;
  readonly onConnect: (flow: ProviderAuthFlow) => Promise<void>;
  readonly onSetCredential: (credential: string) => Promise<void>;
  readonly onDisconnect: () => Promise<void>;
}

interface ProviderSubscriptionAuthControlsProps extends ProviderSubscriptionAuthController {
  readonly presentation: ProviderSubscriptionPresentation;
  readonly readOnly: boolean;
}

type TranslateMessage = ReturnType<typeof useInterfaceTranslator>["message"];

export type AuthDialog =
  | { readonly kind: "connect"; readonly state: ProviderAuthDialogState }
  | {
      readonly kind: "credential";
      readonly state: "entry" | "saving" | "failed";
      readonly value: string;
      readonly message?: string | undefined;
    }
  | {
      readonly kind: "disconnect";
      readonly state: "confirm" | "disconnecting" | "failed";
      readonly message?: string | undefined;
    };

function ConnectDialogPanel({
  state,
  providerName,
  translate,
}: {
  readonly state: ProviderAuthDialogState;
  readonly providerName: string;
  readonly translate: TranslateMessage;
}) {
  if (state.status === "browser") {
    return (
      <div className="grid gap-3" data-provider-auth-state={state.status}>
        <p className="text-sm text-muted-foreground">
          {translate("settings.providers.auth.browserDescription", { provider: providerName })}
        </p>
        <a
          href={state.authorizationUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4"
        >
          {translate("settings.providers.auth.continueBrowser")}
          <ExternalLinkIcon className="size-3.5" aria-hidden />
        </a>
      </div>
    );
  }
  if (state.status === "device-code") {
    return (
      <div className="grid gap-3" data-provider-auth-state={state.status}>
        <p className="text-sm text-muted-foreground">
          {translate("settings.providers.auth.deviceDescription")}
        </p>
        <code className="w-fit rounded-lg border border-border bg-muted px-3 py-2 text-base font-semibold tracking-[0.16em] text-foreground">
          {state.userCode}
        </code>
        <a
          href={state.verificationUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4"
        >
          {translate("settings.providers.auth.openVerification")}
          <ExternalLinkIcon className="size-3.5" aria-hidden />
        </a>
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <p className="text-sm text-destructive" data-provider-auth-state={state.status}>
        {state.message}
      </p>
    );
  }
  if (state.status === "connected") {
    return (
      <p className="text-sm text-foreground" data-provider-auth-state={state.status}>
        {translate("settings.providers.auth.connected", { provider: providerName })}
      </p>
    );
  }
  if (state.status === "cancelled") {
    return (
      <p className="text-sm text-muted-foreground" data-provider-auth-state={state.status}>
        {translate("settings.providers.auth.cancelled")}
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground" data-provider-auth-state={state.status}>
      {translate("settings.providers.auth.preparing", { provider: providerName })}
    </p>
  );
}

function authDetail(presentation: ProviderSubscriptionPresentation): string | null {
  const identity = [presentation.account, presentation.plan].filter(Boolean).join(" · ");
  return identity || presentation.rateLimit;
}

function localizedActionLabel(
  presentation: ProviderSubscriptionPresentation,
  translate: TranslateMessage,
): string {
  if (presentation.action === "connect") return translate("settings.providers.auth.connect");
  if (presentation.action === "reconnect") return translate("settings.providers.auth.reconnect");
  if (presentation.action === "disconnect") return translate("settings.providers.auth.disconnect");
  return translate(
    presentation.canDisconnect || presentation.environmentCredential
      ? "settings.providers.auth.replaceCredential"
      : "settings.providers.auth.addCredential",
    { label: presentation.credential?.label ?? translate("settings.providers.auth.credential") },
  );
}

export function ProviderSubscriptionAuthControls({
  presentation,
  flow,
  event,
  readOnly,
  onConnect,
  onSetCredential,
  onDisconnect,
}: ProviderSubscriptionAuthControlsProps) {
  const translate = useInterfaceTranslator().message;
  const [dialog, setDialog] = useState<AuthDialog | null>(null);
  const detail = authDetail(presentation);
  const actionLabel = localizedActionLabel(presentation, translate);
  const selectedFlow = presentation.flows.includes(flow) ? flow : (presentation.flows[0] ?? flow);

  const startConnect = () => {
    setDialog({ kind: "connect", state: { status: "starting" } });
    void onConnect(selectedFlow).catch((error: unknown) =>
      setDialog({
        kind: "connect",
        state: {
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : translate("settings.providers.auth.signInFailed", {
                  provider: presentation.providerName,
                }),
        },
      }),
    );
  };

  const saveCredential = () => {
    if (dialog?.kind !== "credential") return;
    const credential = dialog.value.trim();
    if (credential.length === 0) return;
    // The submitted secret leaves component state before validation begins.
    setDialog({ kind: "credential", state: "saving", value: "" });
    void onSetCredential(credential)
      .then(() => setDialog(null))
      .catch((error: unknown) =>
        setDialog({
          kind: "credential",
          state: "failed",
          value: "",
          message:
            error instanceof Error
              ? error.message
              : translate("settings.providers.auth.saveFailed", {
                  label:
                    presentation.credential?.label ??
                    translate("settings.providers.auth.credential"),
                }),
        }),
      );
  };

  const confirmDisconnect = () => {
    setDialog({ kind: "disconnect", state: "disconnecting" });
    void onDisconnect()
      .then(() => setDialog(null))
      .catch((error: unknown) =>
        setDialog({
          kind: "disconnect",
          state: "failed",
          message:
            error instanceof Error
              ? error.message
              : translate("settings.providers.auth.disconnectFailed", {
                  provider: presentation.providerName,
                }),
        }),
      );
  };

  const disconnecting = dialog?.kind === "disconnect" && dialog.state === "disconnecting";
  const credentialSaving = dialog?.kind === "credential" && dialog.state === "saving";
  const connectState =
    dialog?.kind === "connect" && event
      ? reduceProviderAuthDialogState(dialog.state, toProviderAuthDialogEvent(event))
      : dialog?.kind === "connect"
        ? dialog.state
        : null;

  return (
    <ProviderSubscriptionAuthControlsView
      presentation={presentation}
      readOnly={readOnly}
      detail={detail}
      actionLabel={actionLabel}
      dialog={dialog}
      connectState={connectState}
      disconnecting={disconnecting}
      credentialSaving={credentialSaving}
      translate={translate}
      onPrimaryAction={() => {
        if (presentation.action === "disconnect") {
          setDialog({ kind: "disconnect", state: "confirm" });
          return;
        }
        if (presentation.action === "set-credential") {
          setDialog({ kind: "credential", state: "entry", value: "" });
          return;
        }
        startConnect();
      }}
      onDisconnectRequest={() => setDialog({ kind: "disconnect", state: "confirm" })}
      onClose={() => setDialog(null)}
      onRetry={startConnect}
      onCredentialChange={(value) =>
        setDialog((current) => (current?.kind === "credential" ? { ...current, value } : current))
      }
      onSaveCredential={saveCredential}
      onConfirmDisconnect={confirmDisconnect}
    />
  );
}

export interface ProviderSubscriptionAuthControlsViewProps {
  readonly presentation: ProviderSubscriptionPresentation;
  readonly readOnly: boolean;
  readonly detail: string | null;
  readonly actionLabel: string;
  readonly dialog: AuthDialog | null;
  readonly connectState: ProviderAuthDialogState | null;
  readonly disconnecting: boolean;
  readonly credentialSaving: boolean;
  readonly translate: TranslateMessage;
  readonly onPrimaryAction: () => void;
  readonly onDisconnectRequest: () => void;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onCredentialChange: (value: string) => void;
  readonly onSaveCredential: () => void;
  readonly onConfirmDisconnect: () => void;
}

export function ProviderSubscriptionAuthControlsView({
  presentation,
  readOnly,
  detail,
  actionLabel,
  dialog,
  connectState,
  disconnecting,
  credentialSaving,
  translate,
  onPrimaryAction,
  onDisconnectRequest,
  onClose,
  onRetry,
  onCredentialChange,
  onSaveCredential,
  onConfirmDisconnect,
}: ProviderSubscriptionAuthControlsViewProps) {
  if (readOnly) {
    return (
      <div className="text-xs text-muted-foreground" data-provider-auth-read-only={true}>
        {detail ? <span>{detail} · </span> : null}
        {translate("settings.providers.auth.readOnly")}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 max-w-full justify-items-start gap-1.5 sm:justify-items-end">
      {detail ? (
        <p
          className={cn(
            "max-w-full break-words text-xs text-muted-foreground sm:text-right",
            presentation.tone === "warning" && "text-warning",
            presentation.tone === "error" && "text-destructive",
          )}
          data-provider-auth-detail={true}
        >
          {detail}
        </p>
      ) : null}
      {presentation.environmentCredential ? (
        <p
          className="max-w-sm text-xs text-muted-foreground"
          data-provider-auth-environment-credential={true}
        >
          {translate("settings.providers.auth.environmentCredential")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={presentation.action === "disconnect" ? "outline" : "default"}
          onClick={onPrimaryAction}
          aria-label={translate("settings.providers.auth.actionAria", {
            action: actionLabel,
            provider: presentation.providerName,
          })}
        >
          {actionLabel}
        </Button>
        {presentation.canDisconnect && presentation.action !== "disconnect" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onDisconnectRequest}
            aria-label={translate("settings.providers.auth.disconnectAria", {
              provider: presentation.providerName,
            })}
          >
            {translate("settings.providers.auth.disconnect")}
          </Button>
        ) : null}
      </div>

      {dialog?.kind === "connect" ? (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>
                {translate("settings.providers.auth.connectTitle", {
                  provider: presentation.providerName,
                })}
              </DialogTitle>
              <DialogDescription>
                {translate("settings.providers.auth.connectDescription")}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <ConnectDialogPanel
                state={connectState ?? dialog.state}
                providerName={presentation.providerName}
                translate={translate}
              />
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {translate("settings.common.close")}
              </Button>
              {connectState?.status === "failed" || connectState?.status === "cancelled" ? (
                <Button onClick={onRetry}>{translate("settings.common.retry")}</Button>
              ) : null}
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}

      {dialog?.kind === "credential" && presentation.credential ? (
        <Dialog open onOpenChange={(open) => !open && !credentialSaving && onClose()}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>
                {translate("settings.providers.auth.credentialTitle", {
                  action: actionLabel,
                  provider: presentation.providerName,
                })}
              </DialogTitle>
              <DialogDescription>
                {translate("settings.providers.auth.credentialDescription")}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="grid gap-2">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">
                  {presentation.credential.label}
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  value={dialog.value}
                  disabled={credentialSaving}
                  placeholder={presentation.credential.placeholder}
                  aria-label={`${presentation.providerName} ${presentation.credential.label}`}
                  onChange={(changeEvent) => onCredentialChange(changeEvent.currentTarget.value)}
                />
              </label>
              {dialog.state === "failed" ? (
                <p className="text-sm text-destructive">{dialog.message}</p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" disabled={credentialSaving} onClick={onClose}>
                {translate("settings.common.cancel")}
              </Button>
              <Button
                disabled={credentialSaving || dialog.value.trim().length === 0}
                onClick={onSaveCredential}
                aria-label={translate("settings.providers.auth.saveAria", {
                  label: presentation.credential.label,
                  provider: presentation.providerName,
                })}
              >
                {credentialSaving
                  ? translate("settings.providers.auth.validating")
                  : translate("settings.common.save")}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}

      {dialog?.kind === "disconnect" ? (
        <Dialog open onOpenChange={(open) => !open && !disconnecting && onClose()}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>
                {translate("settings.providers.auth.disconnectTitle", {
                  provider: presentation.providerName,
                })}
              </DialogTitle>
              <DialogDescription>
                {translate("settings.providers.auth.disconnectDescription")}
              </DialogDescription>
            </DialogHeader>
            {dialog.state === "failed" ? (
              <DialogPanel>
                <p className="text-sm text-destructive">{dialog.message}</p>
              </DialogPanel>
            ) : null}
            <DialogFooter>
              <Button variant="outline" disabled={disconnecting} onClick={onClose}>
                {translate("settings.common.cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={disconnecting}
                onClick={onConfirmDisconnect}
                aria-label={translate("settings.providers.auth.confirmDisconnectAria", {
                  provider: presentation.providerName,
                })}
              >
                {disconnecting
                  ? translate("settings.providers.auth.disconnecting")
                  : translate("settings.providers.auth.disconnect")}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}
    </div>
  );
}
