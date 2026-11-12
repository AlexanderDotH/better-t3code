import type { ServerSettings, ServerSettingsPatch, UsageLimitSourceId } from "@t3tools/contracts";
import * as Duration from "effect/Duration";

import { buildBackgroundActivityOverridePatch } from "./server-controls-settings";

export function buildMobileUsageLimitSourcePatch(
  settings: ServerSettings,
  id: UsageLimitSourceId,
  draft: { readonly url: string; readonly managementKey: string; readonly label: string },
): ServerSettingsPatch | null {
  const url = draft.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const existing = settings.usageLimitSources[id];
  const managementKey = draft.managementKey.trim() || existing?.managementKey || "";
  if (!managementKey) return null;
  return {
    usageLimitSources: {
      [id]: {
        ...existing,
        kind: "cliproxy",
        url,
        managementKey,
        label: draft.label.trim() || undefined,
        enabled: existing?.enabled ?? true,
      },
    },
  };
}

export function providerHealthRefreshSettingsPatch(
  settings: ServerSettings,
  draft: string,
): ServerSettingsPatch | null {
  const value = draft.trim();
  if (!/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return null;
  return buildBackgroundActivityOverridePatch(settings, {
    providerHealthRefreshInterval: Duration.seconds(seconds),
  });
}
