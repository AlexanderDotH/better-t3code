"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import type { ProviderAuthConnectEvent } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
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

type AuthDialog =
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
}: {
  readonly state: ProviderAuthDialogState;
  readonly providerName: string;
}) {
  if (state.status === "browser") {
    return (
      <div className="grid gap-3" data-provider-auth-state={state.status}>
        <p className="text-sm text-muted-foreground">
          Complete {providerName} sign-in in your browser. T3 never sends the resulting credential
          back to this client.
        </p>
        <a
          href={state.authorizationUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4"
        >
          Continue in browser <ExternalLinkIcon className="size-3.5" aria-hidden />
        </a>
      </div>
    );
  }
  if (state.status === "device-code") {
    return (
      <div className="grid gap-3" data-provider-auth-state={state.status}>
        <p className="text-sm text-muted-foreground">
          Open the verification page on any device, then enter this one-time code.
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
          Open verification page <ExternalLinkIcon className="size-3.5" aria-hidden />
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
        {providerName} connected. Provider status will refresh automatically.
      </p>
    );
  }
  if (state.status === "cancelled") {
    return (
      <p className="text-sm text-muted-foreground" data-provider-auth-state={state.status}>
        Sign-in was cancelled. You can retry without changing providers.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground" data-provider-auth-state={state.status}>
      Preparing secure {providerName} sign-in…
    </p>
  );
}

function authDetail(presentation: ProviderSubscriptionPresentation): string | null {
  const identity = [presentation.account, presentation.plan].filter(Boolean).join(" · ");
  return identity || presentation.rateLimit;
}

function authActionAriaLabel(presentation: ProviderSubscriptionPresentation): string {
  if (presentation.action === "set-credential") {
    return `${presentation.actionLabel} for ${presentation.providerName}`;
  }
  return `${presentation.actionLabel} ${presentation.providerName}`;
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
  const [dialog, setDialog] = useState<AuthDialog | null>(null);
  const detail = authDetail(presentation);
  const selectedFlow = presentation.flows.includes(flow) ? flow : (presentation.flows[0] ?? flow);

  const startConnect = () => {
    setDialog({ kind: "connect", state: { status: "starting" } });
    void onConnect(selectedFlow).catch((error: unknown) =>
      setDialog({
        kind: "connect",
        state: {
          status: "failed",
          message:
            error instanceof Error ? error.message : `${presentation.providerName} sign-in failed.`,
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
              : `Could not save ${presentation.credential?.label ?? "credential"}.`,
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
              : `Could not disconnect ${presentation.providerName}.`,
        }),
      );
  };

  if (readOnly) {
    return (
      <div className="text-xs text-muted-foreground" data-provider-auth-read-only={true}>
        {detail ? <span>{detail} · </span> : null}
        Authentication actions require edit access to this environment.
      </div>
    );
  }

  const disconnecting = dialog?.kind === "disconnect" && dialog.state === "disconnecting";
  const credentialSaving = dialog?.kind === "credential" && dialog.state === "saving";
  const connectState =
    dialog?.kind === "connect" && event
      ? reduceProviderAuthDialogState(dialog.state, toProviderAuthDialogEvent(event))
      : dialog?.kind === "connect"
        ? dialog.state
        : null;

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
          Using the instance environment credential. Remove it from the provider environment to
          disconnect, or save a key here to override it.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={presentation.action === "disconnect" ? "outline" : "default"}
          onClick={() => {
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
          aria-label={authActionAriaLabel(presentation)}
        >
          {presentation.actionLabel}
        </Button>
        {presentation.canDisconnect && presentation.action !== "disconnect" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialog({ kind: "disconnect", state: "confirm" })}
            aria-label={`Disconnect ${presentation.providerName}`}
          >
            Disconnect
          </Button>
        ) : null}
      </div>

      {dialog?.kind === "connect" ? (
        <Dialog open onOpenChange={(open) => !open && setDialog(null)}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Connect {presentation.providerName}</DialogTitle>
              <DialogDescription>
                Sign in with the account this provider instance should use.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              {ConnectDialogPanel({
                state: connectState ?? dialog.state,
                providerName: presentation.providerName,
              })}
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)}>
                Close
              </Button>
              {connectState?.status === "failed" || connectState?.status === "cancelled" ? (
                <Button onClick={startConnect}>Retry</Button>
              ) : null}
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}

      {dialog?.kind === "credential" && presentation.credential ? (
        <Dialog open onOpenChange={(open) => !open && !credentialSaving && setDialog(null)}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>
                {presentation.actionLabel} for {presentation.providerName}
              </DialogTitle>
              <DialogDescription>
                The key is validated by this environment and stored only for this provider instance.
                It is never returned to the app.
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
                  onChange={(changeEvent) => {
                    const value = changeEvent.currentTarget.value;
                    setDialog((current) =>
                      current?.kind === "credential" ? { ...current, value } : current,
                    );
                  }}
                />
              </label>
              {dialog.state === "failed" ? (
                <p className="text-sm text-destructive">{dialog.message}</p>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" disabled={credentialSaving} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={credentialSaving || dialog.value.trim().length === 0}
                onClick={saveCredential}
                aria-label={`Save ${presentation.credential.label} for ${presentation.providerName}`}
              >
                {credentialSaving ? "Validating…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}

      {dialog?.kind === "disconnect" ? (
        <Dialog open onOpenChange={(open) => !open && !disconnecting && setDialog(null)}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Disconnect {presentation.providerName}?</DialogTitle>
              <DialogDescription>
                This stops new turns for this instance, interrupts its active turns, and removes
                only this instance&apos;s isolated credential.
              </DialogDescription>
            </DialogHeader>
            {dialog.state === "failed" ? (
              <DialogPanel>
                <p className="text-sm text-destructive">{dialog.message}</p>
              </DialogPanel>
            ) : null}
            <DialogFooter>
              <Button variant="outline" disabled={disconnecting} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={disconnecting}
                onClick={confirmDisconnect}
                aria-label={`Confirm disconnect ${presentation.providerName}`}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      ) : null}
    </div>
  );
}
