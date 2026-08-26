import {
  AuthOrchestrationOperateScope,
  defaultInstanceIdForDriver,
  type AuthSessionState,
  type ExecutionEnvironmentCapabilities,
  type ProviderAuthConnectEvent,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderRateLimit,
  type ServerSettings,
  type ServerSettingsPatch,
  type SkillDescriptor,
  type SkillTarget,
} from "@t3tools/contracts";

const LEGACY_PROVIDER_DRIVERS = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "opencode",
  "gemini",
] as const;
type LegacyProviderDriver = (typeof LEGACY_PROVIDER_DRIVERS)[number];

function isLegacyProviderDriver(driver: string): driver is LegacyProviderDriver {
  return LEGACY_PROVIDER_DRIVERS.some((candidate) => candidate === driver);
}

export function supportsEnvironmentAgentSettings(
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
): boolean {
  return (capabilities?.environmentSettingsVersion ?? 0) >= 1;
}

export function providerEnabledSettingsPatch(input: {
  readonly provider: ServerProvider;
  readonly settings: ServerSettings;
  readonly enabled: boolean;
}): ServerSettingsPatch | null {
  const configuredInstance = input.settings.providerInstances[input.provider.instanceId];
  if (configuredInstance !== undefined) {
    return {
      providerInstances: {
        ...input.settings.providerInstances,
        [input.provider.instanceId]: { ...configuredInstance, enabled: input.enabled },
      },
    };
  }

  if (
    !isLegacyProviderDriver(input.provider.driver) ||
    input.provider.instanceId !== defaultInstanceIdForDriver(input.provider.driver)
  ) {
    return null;
  }

  switch (input.provider.driver) {
    case "codex":
      return { providers: { codex: { enabled: input.enabled } } };
    case "claudeAgent":
      return { providers: { claudeAgent: { enabled: input.enabled } } };
    case "cursor":
      return { providers: { cursor: { enabled: input.enabled } } };
    case "grok":
      return { providers: { grok: { enabled: input.enabled } } };
    case "opencode":
      return { providers: { opencode: { enabled: input.enabled } } };
    case "gemini":
      return { providers: { gemini: { enabled: input.enabled } } };
  }
  return null;
}

export function skillMutationTarget(skill: SkillDescriptor): SkillTarget {
  return {
    scope: skill.scope,
    path: skill.path,
    ...(skill.name ? { name: skill.name } : {}),
    ...(skill.providerInstanceId ? { providerInstanceId: skill.providerInstanceId } : {}),
    ...(skill.projectId ? { projectId: skill.projectId } : {}),
    ...(skill.projectCwd ? { projectCwd: skill.projectCwd } : {}),
  };
}

export function providerStatusLabel(provider: ServerProvider): string {
  if (provider.availability === "unavailable") return "Unavailable";
  if (!provider.enabled) return "Disabled";
  if (!provider.installed) return "Not installed";
  if (provider.auth.status === "unauthenticated") {
    return "Sign-in required";
  }
  return provider.status === "ready"
    ? provider.version
      ? `Ready · ${provider.version}`
      : "Ready"
    : (provider.message ?? provider.status);
}

export function providerRateLimitLabel(
  rateLimit: ServerProviderRateLimit | undefined,
): string | null {
  if (rateLimit?.status !== "limited" && rateLimit?.status !== "exhausted") return null;
  if (rateLimit.message) return rateLimit.message;
  if (rateLimit.retryAfterSeconds !== undefined) {
    const minutes = Math.ceil(rateLimit.retryAfterSeconds / 60);
    return `Rate limited · Retry in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return rateLimit.status === "exhausted" ? "Rate limit exhausted" : "Rate limited";
}

export function providerAuthMutationAccess(
  session: Pick<AuthSessionState, "authenticated" | "scopes"> | null,
): "editable" | "read-only" {
  if (session === null || session.scopes === undefined) return "editable";
  if (!session.authenticated) return "read-only";
  return session.scopes.includes(AuthOrchestrationOperateScope) ? "editable" : "read-only";
}

export type MobileProviderAuthEventPresentation =
  | {
      readonly kind: "browser";
      readonly message: string;
      readonly authorizationUrl: string;
    }
  | {
      readonly kind: "device-code";
      readonly message: string;
      readonly verificationUrl: string;
      readonly userCode: string;
    }
  | { readonly kind: "progress" | "success" | "error"; readonly message: string };

export function mobileProviderAuthEventPresentation(
  event: ProviderAuthConnectEvent,
  providerLabel: string,
): MobileProviderAuthEventPresentation {
  switch (event.type) {
    case "starting":
      return { kind: "progress", message: `Preparing secure ${providerLabel} sign-in…` };
    case "browserChallenge":
      return {
        kind: "browser",
        message: `Continue ${providerLabel} sign-in in your browser.`,
        authorizationUrl: event.authorizationUrl,
      };
    case "deviceCodeChallenge":
      return {
        kind: "device-code",
        message: `Enter ${event.userCode} at ${event.verificationUrl}`,
        verificationUrl: event.verificationUrl,
        userCode: event.userCode,
      };
    case "connected":
      return { kind: "success", message: `${providerLabel} connected.` };
    case "failed":
      return { kind: "error", message: event.failure.reason };
    case "cancelled":
      return { kind: "error", message: event.reason ?? "Sign-in was cancelled." };
  }
}

export interface ProviderAuthenticationPresentation {
  readonly action: "connect" | "reconnect" | "disconnect" | "none";
  readonly actionLabel: string;
  readonly credentialActionLabel?: string | undefined;
  readonly credentialLabel?: string | undefined;
  readonly credentialPlaceholder?: string | undefined;
  readonly detail: string;
  readonly providerLabel: string;
  readonly method: "api-key" | "browser" | "device-code";
}

export function providerAuthenticationPresentation(
  provider: ServerProvider,
): ProviderAuthenticationPresentation | null {
  const capabilities = provider.auth.capabilities;
  if (!capabilities) return null;
  const credential = capabilities.credential;
  const method = credential
    ? "api-key"
    : capabilities.flows.includes("device-code")
      ? "device-code"
      : capabilities.flows.includes("browser")
        ? "browser"
        : null;
  if (method === null) return null;

  const providerLabel = provider.displayName ?? String(provider.instanceId);
  const authenticated = provider.auth.status === "authenticated";
  if (authenticated) {
    const accountDetail = [provider.auth.email, provider.auth.label, provider.auth.plan?.label]
      .filter(Boolean)
      .join(" · ");
    return {
      action: capabilities.canDisconnect ? "disconnect" : "none",
      actionLabel: capabilities.canDisconnect ? "Disconnect" : "",
      ...(credential
        ? {
            credentialActionLabel: `Replace ${credential.label}`,
            credentialLabel: credential.label,
            ...(credential.placeholder ? { credentialPlaceholder: credential.placeholder } : {}),
          }
        : {}),
      detail: provider.message ?? (accountDetail || `${providerLabel} connected`),
      providerLabel,
      method,
    };
  }

  const reconnect = provider.auth.status === "expired" || provider.auth.status === "error";
  const credentialLabel = credential?.label;
  const credentialActionLabel = credential
    ? reconnect
      ? `Replace ${credential.label}`
      : `Save ${credential.label}`
    : undefined;
  return {
    action: reconnect ? "reconnect" : "connect",
    actionLabel: credentialActionLabel ?? (reconnect ? "Reconnect" : "Connect"),
    ...(credentialActionLabel ? { credentialActionLabel } : {}),
    ...(credentialLabel ? { credentialLabel } : {}),
    ...(credential?.placeholder ? { credentialPlaceholder: credential.placeholder } : {}),
    detail:
      provider.message ??
      (credential
        ? `${providerLabel} ${credential.label} required`
        : `${providerLabel} sign-in required`),
    providerLabel,
    method,
  };
}

export function providerConfigSettingsPatch(input: {
  readonly instanceId: ProviderInstanceId;
  readonly settings: ServerSettings;
  readonly config: Record<string, unknown> | undefined;
}): ServerSettingsPatch | null {
  const instance = input.settings.providerInstances[input.instanceId];
  if (!instance) return null;
  return {
    providerInstances: {
      ...input.settings.providerInstances,
      [input.instanceId]: {
        ...instance,
        ...(input.config === undefined ? { config: undefined } : { config: input.config }),
      },
    },
  };
}
