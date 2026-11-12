import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";
import { resolveAddressBarInput, resolveSearchUrlTemplate } from "@t3tools/shared/preview";

export function browserAddress(
  input: string,
  settings: Pick<ClientSettings, "browserSearchEngine" | "browserCustomSearchUrl"> | null,
) {
  return resolveAddressBarInput(
    input,
    resolveSearchUrlTemplate(settings ?? DEFAULT_CLIENT_SETTINGS),
  );
}
