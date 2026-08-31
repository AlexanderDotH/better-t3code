import type { ServerProvider, ServerProviderVersionAdvisory } from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

type TranslateMessage = InterfaceTranslator["message"];

/**
 * Visual treatment for each server-reported provider status. Centralized so
 * the default-driver card and per-instance cards share the same language.
 */
export const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-muted-foreground/50",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

export type ProviderStatusKey = keyof typeof PROVIDER_STATUS_STYLES;

/**
 * Derive the headline + detail copy shown under a provider's name in the
 * settings page. Prefers `provider.message` for server-supplied detail and
 * falls back to generic phrasing when the server has not yet reported any
 * state — which happens before the first probe or when an instance names a
 * driver this build does not ship.
 */
export function getProviderSummary(
  provider: ServerProvider | undefined,
  translate: TranslateMessage,
) {
  if (!provider) {
    return {
      headline: translate("settings.providers.status.checking"),
      detail: translate("settings.providers.status.waiting"),
    };
  }
  if (!provider.enabled) {
    return {
      headline: translate("settings.providers.status.disabled"),
      detail: provider.message ?? translate("settings.providers.status.disabledDetail"),
    };
  }
  if (!provider.installed) {
    return {
      headline: translate("settings.providers.status.notFound"),
      detail: provider.message ?? translate("settings.providers.status.cliMissing"),
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel
        ? translate("settings.providers.status.authenticatedWith", { label: authLabel })
        : translate("settings.providers.status.authenticated"),
      detail: provider.message ?? null,
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: translate("settings.providers.status.notAuthenticated"),
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: translate("settings.providers.status.needsAttention"),
      detail: provider.message ?? translate("settings.providers.status.verificationFailed"),
    };
  }
  if (provider.status === "error") {
    return {
      headline: translate("settings.providers.status.unavailable"),
      detail: provider.message ?? translate("settings.providers.status.startupFailed"),
    };
  }
  return {
    headline: translate("settings.providers.status.available"),
    detail: provider.message ?? translate("settings.providers.status.authUnknown"),
  };
}

/**
 * Normalize a version string for display. Adds the `v` prefix when the
 * driver reported a bare version (e.g. `1.2.3`) so cards render
 * consistently regardless of driver.
 */
export function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

export function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
  translate: TranslateMessage,
): {
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
} | null {
  if (!advisory || advisory.status === "current" || advisory.status === "unknown") {
    return null;
  }

  const version = advisory.latestVersion;
  const versionLabel = getProviderVersionLabel(version);

  return {
    detail:
      advisory.message ??
      (versionLabel
        ? translate("settings.providers.update.installVersion", { version: versionLabel })
        : translate("settings.providers.update.installLatest")),
    updateCommand: advisory.updateCommand,
    emphasis: "normal" as const,
  };
}
