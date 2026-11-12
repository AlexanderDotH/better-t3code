import {
  SecretProviderId,
  SecretProviderKind,
  type SecretProviderConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { secretProviderPatch } from "./secret-provider-settings";

const provider: SecretProviderConfig = {
  kind: SecretProviderKind.make("one_password"),
  label: "Work vault",
  config: { account: "work.1password.com" },
};

describe("secretProviderPatch", () => {
  it("creates stable ids and refuses collisions after name normalization", () => {
    expect(
      secretProviderPatch({
        label: " Work vault ",
        account: " work.1password.com ",
        providers: {},
      }),
    ).toEqual({ secretProviders: { "work-vault": provider } });
    expect(
      secretProviderPatch({
        label: "Work---vault",
        account: "work",
        providers: { "work-vault": provider },
      }),
    ).toBeNull();
    expect(secretProviderPatch({ label: "🔐", account: "work", providers: {} })).toBeNull();
  });

  it("keeps the account and id when editing a label without entering a replacement account", () => {
    const editingId = SecretProviderId.make("work-vault");
    const patch = secretProviderPatch({
      editingId,
      label: "Company",
      account: "",
      providers: { [editingId]: provider },
    });
    expect(patch).toEqual({ secretProviders: { "work-vault": { ...provider, label: "Company" } } });
    expect(
      secretProviderPatch({ editingId, label: "Company", account: "replacement", providers: {} }),
    ).toBeNull();
  });

  it.each(["-account", "with spaces", "https://work.1password.com", "a".repeat(254), ""])(
    "rejects invalid account %s",
    (account) => {
      expect(secretProviderPatch({ label: "Work", account, providers: {} })).toBeNull();
    },
  );
});
