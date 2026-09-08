export function resolveAssemblyAiVoiceInputAvailability(input: {
  readonly featureEnabled: boolean;
  readonly environmentSettingsVersion: number | undefined;
  readonly apiKeyConfigured: boolean;
}): { readonly available: boolean; readonly configured: boolean } {
  const available = input.featureEnabled && (input.environmentSettingsVersion ?? 0) >= 1;
  return { available, configured: available && input.apiKeyConfigured };
}
