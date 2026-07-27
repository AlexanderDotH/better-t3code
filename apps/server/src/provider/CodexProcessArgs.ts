const MANAGED_CODEX_DISABLED_FEATURES = ["image_generation"] as const;

function disableFeatureArgs(features: ReadonlyArray<string>): string[] {
  return features.flatMap((feature) => ["--disable", feature]);
}

export function codexManagedFeatureArgs(): string[] {
  return disableFeatureArgs(MANAGED_CODEX_DISABLED_FEATURES);
}

export function codexAppServerArgs(): string[] {
  return ["app-server", ...codexManagedFeatureArgs()];
}

export function codexExecArgs(args: ReadonlyArray<string>): string[] {
  return ["exec", ...codexManagedFeatureArgs(), ...args];
}
