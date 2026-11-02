import { providerClients } from "@t3tools/client-runtime/provider-clients";
import { ProviderDriverKind } from "@t3tools/contracts";
export { providerClients };
export function getDriverOption(driver: string | undefined) {
  return driver === undefined ? undefined : providerClients.get(ProviderDriverKind.make(driver));
}
