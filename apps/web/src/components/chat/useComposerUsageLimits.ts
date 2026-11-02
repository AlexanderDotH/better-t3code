import { useStableCallback } from "../../hooks/useStableCallback";
import type {
  ProviderInstanceId,
  ServerProvider,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { collectProviderUsageLimits, hasProviderUsageLimits } from "@t3tools/shared/usageLimits";
import { useId, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { persistClientSettingsUpdate, useClientSettings } from "../../hooks/useSettings";
import { toastManager } from "../ui/toast";

export function useComposerUsageLimits({
  instanceId,
  providers,
  sources,
  available,
}: {
  readonly instanceId: ProviderInstanceId | null;
  readonly providers: readonly ServerProvider[];
  readonly sources: UsageLimitSourceSnapshots;
  readonly available: boolean;
}) {
  const visible = useClientSettings((settings) => settings.composerUsageLimitsVisible);
  const translate = useInterfaceTranslator().message;
  const nowMinute = useNowMinute();
  const id = useId();
  const [opening, setOpening] = useState(0);
  const selectedProvider = providers.find((provider) => provider.instanceId === instanceId);
  const offered =
    available &&
    selectedProvider !== undefined &&
    hasProviderUsageLimits(selectedProvider.driver, providers, sources);
  const report =
    visible && offered && instanceId !== null
      ? collectProviderUsageLimits(
          instanceId,
          providers,
          sources,
          Date.parse(`${nowMinute}:00.000Z`),
        )
      : null;

  const dismiss = useStableCallback(async () => {
    try {
      await persistClientSettingsUpdate((current) => ({
        ...current,
        composerUsageLimitsVisible: false,
      }));
    } catch {
      // The stack has already animated dismissal; restore it if saving failed.
      setOpening((current) => current + 1);
      toastManager.add({
        type: "error",
        title: translate("chat.composer.usageLimits.visibilitySaveFailed"),
      });
    }
  });
  const toggle = useStableCallback(async () => {
    if (
      !offered ||
      instanceId === null ||
      collectProviderUsageLimits(instanceId, providers, sources, Date.now()) === null
    ) {
      toastManager.add({
        type: "info",
        title: translate("chat.composer.usageLimits.unavailable"),
      });
      return false;
    }
    // A new opening must not reuse the banner stack's last dismissed id.
    setOpening((current) => current + 1);
    try {
      await persistClientSettingsUpdate((current) => ({
        ...current,
        composerUsageLimitsVisible: !current.composerUsageLimitsVisible,
      }));
      return true;
    } catch {
      toastManager.add({
        type: "error",
        title: translate("chat.composer.usageLimits.visibilitySaveFailed"),
      });
      return false;
    }
  });

  return { report, offered, bannerId: `usage-limits:${id}:${opening}`, toggle, dismiss };
}
