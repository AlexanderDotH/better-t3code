import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  defaultInstanceIdForDriver,
  type ServerProvider,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";

const OPENROUTER_DRIVER_KIND = ProviderDriverKind.make("openrouter");

function objectConfig(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

/**
 * Persist the first valid OpenRouter model chosen from its setup catalog.
 *
 * The provider remains turn-blocked while its configured default is missing,
 * removed, or incompatible. Model pickers are the recovery surface, so a
 * valid selection promotes the default instance when needed and only rewrites
 * the selected instance's opaque driver config.
 */
export function resolveOpenRouterBootstrapModelPatch(input: {
  readonly settings: Pick<ServerSettings, "providerInstances" | "providers">;
  readonly provider: ServerProvider;
  readonly model: string;
}): ServerSettingsPatch | null {
  if (
    input.provider.driver !== OPENROUTER_DRIVER_KIND ||
    input.provider.auth.status !== "authenticated"
  ) {
    return null;
  }
  const model = input.model.trim();
  const selectedModel = input.provider.models.find((candidate) => candidate.slug === model);
  if (!selectedModel || selectedModel.isSelectable === false) return null;

  const instanceId = input.provider.instanceId;
  const explicitInstance = input.settings.providerInstances?.[instanceId];
  if (explicitInstance && explicitInstance.driver !== OPENROUTER_DRIVER_KIND) return null;
  const isDefault = instanceId === defaultInstanceIdForDriver(OPENROUTER_DRIVER_KIND);
  if (!explicitInstance && !isDefault) return null;

  const instance =
    explicitInstance ??
    (() => {
      const { enabled, ...config } = input.settings.providers.openrouter;
      return {
        driver: OPENROUTER_DRIVER_KIND,
        enabled,
        config,
      } as const;
    })();
  const config = objectConfig(instance.config);
  const configuredDefault = config.defaultModel;
  if (
    typeof configuredDefault === "string" &&
    input.provider.models.some(
      (candidate) =>
        candidate.slug === configuredDefault.trim() && candidate.isSelectable !== false,
    )
  ) {
    return null;
  }

  return {
    ...(isDefault
      ? {
          providers: {
            ...input.settings.providers,
            openrouter: DEFAULT_SERVER_SETTINGS.providers.openrouter,
          },
        }
      : {}),
    providerInstances: {
      ...input.settings.providerInstances,
      [instanceId]: {
        ...instance,
        config: {
          ...config,
          defaultModel: model,
        },
      },
    },
  };
}
