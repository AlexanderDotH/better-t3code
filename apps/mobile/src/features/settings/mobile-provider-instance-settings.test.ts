import {
  ProviderDriverKind,
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  ProviderInstanceEnvironment,
  ProviderInstanceEnvironmentVariableName,
  SecretProviderId,
  ServerSettingsPatch,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildMobileProviderInstance,
  editMobileProviderVariable,
  serializeMobileProviderEnvironment,
  moveMobileProviderModel,
  mobileProviderInstanceFor,
  mobileProviderModelPreferencesPatch,
} from "./mobile-provider-instance-settings";

const encodeProviderEnvironment = Schema.encodeSync(ProviderInstanceEnvironment);
const encodeSettingsPatch = Schema.encodeSync(ServerSettingsPatch);

describe("mobile provider instance edits", () => {
  it("preserves config, secrets and disabled state when changing metadata", () => {
    const instance: ProviderInstanceConfig = {
      driver: ProviderDriverKind.make("codex"),
      enabled: false,
      displayName: "Old",
      accentColor: "#123456",
      config: { homePath: "/home/agent", futureSetting: true },
      environment: [
        {
          name: ProviderInstanceEnvironmentVariableName.make("TOKEN"),
          value: "",
          valueRedacted: true,
          sensitive: true,
        },
      ],
    };
    expect(
      buildMobileProviderInstance(instance, { displayName: " Work ", accentColor: "" }),
    ).toEqual({ ...instance, displayName: "Work", accentColor: undefined });
    expect(buildMobileProviderInstance(instance, { displayName: "" }).displayName).toBeUndefined();
    const instanceId = ProviderInstanceId.make("codex");
    const provider = { instanceId, driver: instance.driver, enabled: true };
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        codex: { ...DEFAULT_SERVER_SETTINGS.providers.codex, homePath: "/host/codex" },
      },
    };
    expect(mobileProviderInstanceFor(settings, provider).config).toMatchObject({
      homePath: "/host/codex",
    });
    expect(
      mobileProviderInstanceFor(
        { ...settings, providerInstances: { [instanceId]: instance } },
        provider,
      ),
    ).toBe(instance);
  });

  it("retains redacted values until explicitly replaced and encodes references for older servers", () => {
    const redacted = { name: "TOKEN", value: "", sensitive: true, valueRedacted: true };
    expect(editMobileProviderVariable(redacted, { name: "RENAMED" })).toBeNull();
    expect(editMobileProviderVariable(redacted, { sensitive: false })).toBeNull();
    expect(editMobileProviderVariable(redacted, { value: "replacement" })).toEqual({
      ...redacted,
      value: "replacement",
      valueRedacted: false,
    });
    const reference = editMobileProviderVariable(redacted, {
      value: { provider: SecretProviderId.make("onepassword"), reference: "op://work/item/token" },
    });
    const environment = serializeMobileProviderEnvironment([reference!]);
    expect(environment).not.toBeNull();
    expect(encodeProviderEnvironment(environment!)).toEqual([
      {
        name: "TOKEN",
        value: "",
        sensitive: true,
        secret: { provider: "onepassword", reference: "op://work/item/token" },
        valueRedacted: false,
      },
    ]);
    expect(serializeMobileProviderEnvironment([{ ...redacted, name: "not valid" }])).toBeNull();
    expect(serializeMobileProviderEnvironment([redacted, redacted])).toBeNull();
    expect(
      serializeMobileProviderEnvironment([
        {
          ...redacted,
          value: { provider: SecretProviderId.make("onepassword"), reference: "\ninvalid" },
        },
      ]),
    ).toBeNull();
  });

  it("moves models while retaining unknown saved slugs and removing duplicate ordering entries", () => {
    expect(moveMobileProviderModel(["a", "b", "c"], ["b", "old", "b"], "a", -1)).toEqual([
      "a",
      "b",
      "c",
      "old",
    ]);
    expect(moveMobileProviderModel(["a", "b"], [], "a", -1)).toEqual(["a", "b"]);
    const instanceId = ProviderInstanceId.make("codex_work");
    const settings = {
      providerModelPreferences: {
        other: { hiddenModels: ["hidden"], modelOrder: ["first"] },
        [instanceId]: { hiddenModels: ["b"], modelOrder: ["b", "old", "b"] },
      },
    };
    const patch = mobileProviderModelPreferencesPatch(settings, instanceId, {
      modelOrder: moveMobileProviderModel(
        ["a", "b", "c"],
        settings.providerModelPreferences[instanceId]!.modelOrder,
        "a",
        -1,
      ),
    });
    expect(encodeSettingsPatch(patch)).toEqual({
      providerModelPreferences: {
        other: settings.providerModelPreferences.other,
        [instanceId]: { hiddenModels: ["b"], modelOrder: ["a", "b", "c", "old"] },
      },
    });
  });
});
