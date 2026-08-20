import {
  defaultInstanceIdForDriver,
  type ExecutionEnvironmentCapabilities,
  type ServerProvider,
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
