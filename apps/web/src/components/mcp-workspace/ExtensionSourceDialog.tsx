import type { EnvironmentId, ExtensionCatalogEntry } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { acquireDesktopTab } from "~/browser/desktopTabLifetime";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { randomUUID } from "~/lib/utils";
import { previewBridge } from "../preview/previewBridge";
import { catalogSourceUrl } from "./extensionStore.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

const SOURCE_PAGE_LOAD_TIMEOUT_MS = 20_000;

export function ExtensionSourcePage(props: { environmentId: EnvironmentId; url: string }) {
  const t = useInterfaceTranslator().message;
  const containerRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const bridge = previewBridge;
    const container = containerRef.current;
    if (!bridge || !container) return;
    let disposed = false;
    let navigationFailed = false;
    let navigation = 0;
    let loadingTimeout: ReturnType<typeof setTimeout>;
    let removeGuest = () => {};
    const fail = () => {
      navigationFailed = true;
      clearTimeout(loadingTimeout);
      if (!disposed) setStatus("error");
    };
    const startLoading = () => {
      navigation += 1;
      navigationFailed = false;
      clearTimeout(loadingTimeout);
      setStatus("loading");
      loadingTimeout = setTimeout(fail, SOURCE_PAGE_LOAD_TIMEOUT_MS);
    };
    const tabId = `extension-source-${randomUUID()}-${attempt}`;
    const lease = acquireDesktopTab(tabId);
    startLoading();
    void Promise.all([lease.ready, bridge.getPreviewConfig(props.environmentId)])
      .then(([, config]) => {
        if (disposed || navigationFailed) return;
        const guest = document.createElement("webview");
        guest.setAttribute("partition", config.partition);
        guest.setAttribute("webpreferences", config.webPreferences);
        guest.className = "flex h-full w-full";
        const started = (event: Event) => {
          if ("isMainFrame" in event && event.isMainFrame === false) return;
          // History/hash changes do not load a new document or emit dom-ready.
          if ("isInPlace" in event && event.isInPlace === true) return;
          if (!disposed) startLoading();
        };
        const ready = async () => {
          const readyNavigation = navigation;
          try {
            await bridge.registerWebview(tabId, guest.getWebContentsId());
            if (!disposed && !navigationFailed && navigation === readyNavigation) {
              clearTimeout(loadingTimeout);
              setStatus("ready");
            }
          } catch {
            if (!disposed && navigation === readyNavigation) fail();
          }
        };
        const failed = (event: Event) => {
          if ("isMainFrame" in event && event.isMainFrame === false) return;
          if ("errorCode" in event && event.errorCode === -3) return;
          fail();
        };
        guest.addEventListener("did-start-navigation", started);
        guest.addEventListener("dom-ready", ready);
        guest.addEventListener("did-stop-loading", ready);
        guest.addEventListener("did-fail-load", failed);
        guest.addEventListener("render-process-gone", fail);
        guest.setAttribute("src", props.url);
        container.append(guest);
        removeGuest = () => {
          guest.removeEventListener("did-start-navigation", started);
          guest.removeEventListener("dom-ready", ready);
          guest.removeEventListener("did-stop-loading", ready);
          guest.removeEventListener("did-fail-load", failed);
          guest.removeEventListener("render-process-gone", fail);
          guest.remove();
        };
      })
      .catch(() => {
        if (!disposed) fail();
      });
    return () => {
      disposed = true;
      clearTimeout(loadingTimeout);
      removeGuest();
      lease.release();
    };
  }, [attempt, props.environmentId, props.url]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden border-y">
      <div ref={containerRef} className="absolute inset-0" />
      {status !== "ready" ? (
        <div
          role={status === "error" ? "alert" : "status"}
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center text-sm text-muted-foreground"
        >
          <p>
            {t(
              status === "error"
                ? "settings.mcp.store.sourceFailed"
                : "settings.mcp.store.sourceLoading",
            )}
          </p>
          {status === "error" ? (
            <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
              {t("settings.mcp.store.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ExtensionSourceDialog(props: {
  entry: ExtensionCatalogEntry;
  environmentId: EnvironmentId;
  onClose: () => void;
  onSetup: () => void;
  installed?: boolean;
  onManage?: () => void;
}) {
  const t = useInterfaceTranslator().message;
  const sourceUrl = catalogSourceUrl(props.entry.sourceUrl);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="h-[85dvh] max-w-5xl">
        <DialogHeader className="shrink-0 pr-12">
          <DialogTitle>{props.entry.name}</DialogTitle>
          <DialogDescription className="break-all">{props.entry.sourceUrl}</DialogDescription>
        </DialogHeader>
        {previewBridge && sourceUrl ? (
          <ExtensionSourcePage environmentId={props.environmentId} url={sourceUrl} />
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm">
            <p>{props.entry.description}</p>
            <p className="text-muted-foreground">{t("settings.mcp.store.sourceDesktop")}</p>
          </div>
        )}
        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            render={<a href={sourceUrl ?? undefined} target="_blank" rel="noreferrer" />}
            disabled={sourceUrl === null}
          >
            <ExternalLinkIcon className="size-3.5" />
            {t("settings.mcp.store.openExternal")}
          </Button>
          <Button
            disabled={props.installed && !props.onManage}
            onClick={props.installed ? props.onManage : props.onSetup}
          >
            {t(
              props.installed
                ? props.onManage
                  ? "settings.mcp.store.manage"
                  : "settings.mcp.store.installed"
                : props.entry.kind === "skill"
                  ? "settings.mcp.store.preview"
                  : "settings.mcp.store.setup",
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
