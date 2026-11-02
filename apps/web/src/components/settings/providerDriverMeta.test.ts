import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { deriveProviderSettingsFields } from "./ProviderSettingsForm";
import { providerClients } from "./providerDriverMeta";
describe("provider settings schemas", () => {
  it("shows the routing fields selected by the OpenRouter routing mode", () => {
    const definition = providerClients.get(ProviderDriverKind.make("openrouter"));
    expect(definition).toBeDefined();
    const keys = (routingMode: string) =>
      deriveProviderSettingsFields(definition!, { routingMode }).map((field) => field.key);
    expect(keys("openrouter-default")).not.toContain("providerOrder");
    expect(keys("openrouter-default")).not.toContain("routingSort");
    expect(keys("provider-order")).toContain("providerOrder");
    expect(keys("provider-order")).not.toContain("routingSort");
    expect(keys("sort")).toContain("routingSort");
    expect(keys("sort")).not.toContain("providerOrder");
  });
  it("exposes only the local executable configuration for a local ACP entry", () => {
    const definition = providerClients.get(ProviderDriverKind.make("acpRegistry"));
    expect(definition).toBeDefined();
    const fields = deriveProviderSettingsFields(definition!, { source: "local" });
    expect(fields.map((field) => field.key)).toEqual(["source", "commandPath"]);
    expect(fields.find((field) => field.key === "commandPath")?.label).toBe("Executable");
  });
});
