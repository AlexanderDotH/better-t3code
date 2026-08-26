import { type ServerProvider } from "@t3tools/contracts";
import { memo } from "react";
import { InfoIcon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { formatProviderDriverKindLabel } from "../../providerModels";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const STATUS_TONE = {
  error: {
    surface: "border-error/32 bg-error-surface text-error-foreground",
    icon: "text-error",
    message: "text-error-foreground/80",
    dismiss: "text-error-foreground/60",
  },
  warning: {
    surface: "border-warning/32 bg-warning-surface text-warning-foreground",
    icon: "text-warning",
    message: "text-warning-foreground/80",
    dismiss: "text-warning-foreground/60",
  },
} as const;

export function getProviderStatusBannerKey(status: ServerProvider | null): string | null {
  return !status || status.status === "ready" || status.status === "disabled"
    ? null
    : [status.instanceId, status.status, status.auth.status, status.message ?? ""].join("\u0000");
}

export function shouldShowProviderStatusBanner(
  status: ServerProvider | null,
  dismissedBannerKey: string | null,
): boolean {
  const bannerKey = getProviderStatusBannerKey(status);
  return bannerKey !== null && bannerKey !== dismissedBannerKey;
}

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  onDismiss,
  status,
}: {
  onDismiss: () => void;
  status: ServerProvider | null;
}) {
  if (!status || status.status === "ready" || status.status === "disabled") {
    return null;
  }

  const providerName = status.displayName?.trim() || formatProviderDriverKindLabel(status.driver);
  const isUnauthenticated = status.status === "error" && status.auth.status === "unauthenticated";
  const title = isUnauthenticated
    ? `${providerName} is unauthenticated`
    : `${providerName} provider status`;
  const message = isUnauthenticated
    ? "Sign in via the CLI to authenticate again."
    : (status.message ??
      (status.status === "error"
        ? `${providerName} provider is unavailable.`
        : `${providerName} provider has limited availability.`));
  const tone = STATUS_TONE[status.status === "warning" ? "warning" : "error"];

  return (
    <div className="pointer-events-auto mx-auto w-fit max-w-[calc(100%-2rem)] pt-3">
      <div
        className={cn(
          "relative inline-flex items-center gap-3 rounded-xl border py-3 ps-3.5 pe-10 text-sm shadow-sm",
          tone.surface,
        )}
        data-variant={status.status === "warning" ? "warning" : "error"}
        role="alert"
      >
        <InfoIcon className={cn("size-4 shrink-0", tone.icon)} aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="font-medium">{title}</div>
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  className={cn("line-clamp-3", tone.message)}
                  data-provider-status-message="true"
                >
                  {message}
                </div>
              }
            />
            <TooltipPopup side="top" className="max-w-96 whitespace-pre-wrap">
              {message}
            </TooltipPopup>
          </Tooltip>
        </div>
        <Button
          aria-label={`Dismiss ${providerName} provider ${status.status}`}
          className="absolute top-2 right-2 size-6 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon aria-hidden className={cn("size-3.5", tone.dismiss)} />
        </Button>
      </div>
    </div>
  );
});
