import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { isElectron } from "../../env";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  canCheckForUpdate,
  getDesktopUpdateActionError,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "../desktopUpdate.logic";
import { showDesktopUpdateDownloadedToast } from "../desktopUpdate.toast";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Separator } from "../ui/separator";
import { SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DesktopUpdateStatusIcon,
  shouldContinueDesktopUpdateCheckAnimation,
  shouldShowDesktopUpdateCheckIcon,
} from "./DesktopUpdateStatusIcon";

function resolveSidebarUpdatePresentation({
  action,
  isDownloading,
  showCheckIcon,
}: {
  readonly action: ReturnType<typeof resolveDesktopUpdateButtonAction>;
  readonly isDownloading: boolean;
  readonly showCheckIcon: boolean;
}) {
  const showUpdateDetails = action !== "none" || isDownloading;
  const iconStatus = showCheckIcon
    ? "checking"
    : action === "install"
      ? "downloaded"
      : isDownloading
        ? "downloading"
        : action === "download"
          ? "available"
          : "idle";

  return {
    iconStatus,
    showUpdateDetails,
    showUpdateIconState: showUpdateDetails && !showCheckIcon,
  } as const;
}

function keyReleaseNoteItems(items: ReadonlyArray<string>) {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const occurrence = occurrences.get(item) ?? 0;
    occurrences.set(item, occurrence + 1);
    return { item, key: JSON.stringify([item, occurrence]) };
  });
}

function localizedUpdateTooltip(
  state: NonNullable<ReturnType<typeof useDesktopUpdateState>>,
  translator: InterfaceTranslator,
): string {
  if (state.status === "available") {
    return state.availableVersion
      ? translator.message("sidebar.update.versionReadyToDownload", {
          version: state.availableVersion,
        })
      : translator.message("sidebar.update.readyToDownload");
  }
  if (state.status === "downloading") {
    return typeof state.downloadPercent === "number"
      ? translator.message("sidebar.update.downloadingProgress", {
          percent: Math.floor(state.downloadPercent),
        })
      : translator.message("sidebar.update.downloading");
  }
  if (state.status === "downloaded") {
    return translator.message("sidebar.update.downloaded", {
      version: state.downloadedVersion ?? state.availableVersion ?? "",
    });
  }
  if (state.status === "error") {
    if (state.errorContext === "download" && state.availableVersion) {
      return translator.message("sidebar.update.downloadRetry", {
        version: state.availableVersion,
      });
    }
    if (state.errorContext === "install" && state.downloadedVersion) {
      return translator.message("sidebar.update.installRetry", {
        version: state.downloadedVersion,
      });
    }
    if (state.downloadedVersion) {
      return translator.message("sidebar.update.downloaded", {
        version: state.downloadedVersion,
      });
    }
    return state.message ?? translator.message("sidebar.update.failed");
  }
  return translator.message("sidebar.update.current");
}

function SidebarUpdateReleaseNotesTooltip({
  state,
  tooltip,
}: {
  readonly state: NonNullable<ReturnType<typeof useDesktopUpdateState>>;
  readonly tooltip: string;
}) {
  const translator = useInterfaceTranslator();
  if (state.channel !== "nightly" || state.releaseNotes.length === 0) {
    return <>{tooltip}</>;
  }

  return (
    <div className="w-fit max-w-[min(24rem,calc(100vw-2rem))] text-left">
      <div className="px-1">
        {state.status === "available" ? (
          <div>
            <div className="whitespace-nowrap text-sm leading-5 font-medium">
              {translator.message("sidebar.update.readyToDownload")}
            </div>
            {state.availableVersion ? (
              <div className="mt-0.5 text-xs leading-4 text-update-foreground">
                {state.availableVersion}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-sm leading-5 font-medium">{tooltip}</div>
        )}
      </div>
      <div className="max-h-[min(28rem,calc(100vh-6rem))] overflow-y-auto px-1 pt-4 pb-1">
        {state.releaseNotes.map((releaseNote, index) => (
          <div key={releaseNote.version}>
            {index > 0 && <Separator className="my-3 bg-border/60" />}
            <section>
              <h3 className="text-foreground text-xs leading-4 font-semibold">
                {index === 0
                  ? translator.message("sidebar.update.whatsChanged")
                  : translator.message("sidebar.update.changesIn", {
                      version: releaseNote.version,
                    })}
              </h3>
              <ul className="mt-2 space-y-1.5 pl-4 text-xs leading-5 text-popover-foreground/90">
                {keyReleaseNoteItems(releaseNote.items).map(({ item, key }) => (
                  <li className="list-disc break-words" key={key}>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SidebarUpdateArchitectureWarning() {
  return isElectron ? <SidebarUpdateArchitectureWarningContent /> : null;
}

function SidebarUpdateArchitectureWarningContent() {
  const translator = useInterfaceTranslator();
  const state = useDesktopUpdateState();
  const visible = shouldShowArm64IntelBuildWarning(state);
  const description =
    state && visible
      ? translator.message(
          resolveDesktopUpdateButtonAction(state) === "download"
            ? "sidebar.update.armDownloadDescription"
            : resolveDesktopUpdateButtonAction(state) === "install"
              ? "sidebar.update.armInstallDescription"
              : "sidebar.update.armNextDescription",
        )
      : null;

  if (!visible || !description) return null;

  return (
    <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8 text-xs">
      <TriangleAlertIcon />
      <AlertTitle>{translator.message("sidebar.update.intelOnAppleSilicon")}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}

export function SidebarUpdatePill() {
  return isElectron ? <SidebarUpdateControl /> : null;
}

function SidebarUpdateControl() {
  const translator = useInterfaceTranslator();
  const state = useDesktopUpdateState();
  const [isActionPending, setIsActionPending] = useState(false);
  const [checkAnimationKey, setCheckAnimationKey] = useState(0);
  const [isCheckAnimationLatched, setIsCheckAnimationLatched] = useState(false);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    if (prefersReducedMotion) {
      setIsCheckAnimationLatched(false);
    } else if (state?.status === "checking") {
      setIsCheckAnimationLatched(true);
    }
  }, [prefersReducedMotion, state?.status]);

  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";
  const isDownloading = state?.status === "downloading";
  const showCheckIcon = shouldShowDesktopUpdateCheckIcon({
    isAnimationLatched: isCheckAnimationLatched,
    isChecking: state?.status === "checking",
    prefersReducedMotion,
  });
  const { iconStatus, showUpdateDetails, showUpdateIconState } = resolveSidebarUpdatePresentation({
    action,
    isDownloading,
    showCheckIcon,
  });
  const tooltip = showUpdateDetails
    ? state
      ? localizedUpdateTooltip(state, translator)
      : translator.message("sidebar.update.available")
    : showCheckIcon
      ? translator.message("sidebar.update.checking")
      : translator.message("sidebar.update.check");
  const disabled = showCheckIcon
    ? true
    : showUpdateDetails
      ? isDesktopUpdateButtonDisabled(state)
      : !canCheckForUpdate(state);
  const isInteractionDisabled = disabled || isActionPending;

  const handleAction = useCallback(async () => {
    const bridge = window.desktopBridge;
    if (!bridge || !state) return;
    if (isInteractionDisabled) return;

    setIsActionPending(true);

    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            showDesktopUpdateDownloadedToast(bridge, result.state, translator);
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.update.downloadFailed"),
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.update.downloadStartFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translator.message("sidebar.error.unexpected"),
            }),
          );
        })
        .finally(() => setIsActionPending(false));
      return;
    }

    if (action === "install") {
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          translator.message("sidebar.update.installConfirm", {
            version:
              (state.downloadedVersion ?? state.availableVersion)
                ? ` ${state.downloadedVersion ?? state.availableVersion}`
                : "",
          }),
        );
      } catch (error) {
        setIsActionPending(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translator.message("sidebar.update.confirmFailed"),
            description:
              error instanceof Error
                ? error.message
                : translator.message("sidebar.update.confirmationFailed"),
          }),
        );
        return;
      }
      if (!confirmed) {
        setIsActionPending(false);
        return;
      }
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.update.installFailed"),
              description: actionError,
            }),
          );
        })
        .catch((error) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: translator.message("sidebar.update.installFailed"),
              description:
                error instanceof Error
                  ? error.message
                  : translator.message("sidebar.error.unexpected"),
            }),
          );
        })
        .finally(() => setIsActionPending(false));
      return;
    }

    if (!prefersReducedMotion) {
      setIsCheckAnimationLatched(true);
      setCheckAnimationKey((key) => key + 1);
    }
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (result.checked) return;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translator.message("sidebar.update.checkFailed"),
            description:
              result.state.message ?? translator.message("sidebar.update.downloadUnavailable"),
          }),
        );
      })
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: translator.message("sidebar.update.checkFailed"),
            description:
              error instanceof Error
                ? error.message
                : translator.message("sidebar.update.checkError"),
          }),
        );
      })
      .finally(() => setIsActionPending(false));
  }, [action, isInteractionDisabled, prefersReducedMotion, state, translator]);

  const handleCheckAnimationIteration = useCallback(() => {
    setIsCheckAnimationLatched(
      shouldContinueDesktopUpdateCheckAnimation({
        isChecking: state?.status === "checking",
        prefersReducedMotion,
      }),
    );
  }, [prefersReducedMotion, state?.status]);

  return (
    <SidebarMenuItem className="ml-auto shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={tooltip}
              aria-disabled={isInteractionDisabled || undefined}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-full outline-hidden ring-ring transition-colors focus-visible:ring-2",
                isInteractionDisabled ? "cursor-not-allowed" : "cursor-pointer",
                showUpdateIconState
                  ? cn(
                      "bg-update-surface text-update-foreground",
                      !isInteractionDisabled && "hover:bg-update/12",
                    )
                  : cn(
                      "text-[var(--sidebar-icon-color)]",
                      !isInteractionDisabled &&
                        "hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                    ),
                disabled && !showUpdateIconState && "opacity-60",
              )}
              onClick={handleAction}
            >
              <DesktopUpdateStatusIcon
                key={showCheckIcon ? checkAnimationKey : iconStatus}
                downloadPercent={state?.downloadPercent ?? null}
                isCheckAnimating={showCheckIcon && !prefersReducedMotion}
                onCheckAnimationIteration={handleCheckAnimationIteration}
                status={iconStatus}
              />
            </button>
          }
        />
        <TooltipPopup
          align="center"
          className={
            showUpdateDetails && state?.channel === "nightly" && state.releaseNotes.length > 0
              ? // pointer-events-auto overrides the positioner's pointer-events-none so the
                // release notes stay open (and scrollable) when the cursor moves into them.
                "pointer-events-auto max-w-none text-balance"
              : undefined
          }
          side="top"
          style={
            showUpdateDetails
              ? {
                  background:
                    "color-mix(in srgb, var(--update) 18%, color-mix(in srgb, var(--popover) var(--glass-opacity), transparent))",
                  borderColor: "var(--update-foreground)",
                }
              : undefined
          }
          variant={showUpdateDetails ? "glass" : "default"}
        >
          {showUpdateDetails && state ? (
            <SidebarUpdateReleaseNotesTooltip state={state} tooltip={tooltip} />
          ) : (
            tooltip
          )}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
