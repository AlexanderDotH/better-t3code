import {
  SecretProviderId,
  SecretProviderKind,
  SecretProviderLabel,
  type SecretProviderConfig,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const isMobileSecretsFeatureEnabled = ["1", "true"].includes(
  process.env.EXPO_PUBLIC_T3CODE_FEATURE_SECRETS?.trim().toLowerCase() ?? "",
);
const decodeLabel = Schema.decodeUnknownOption(SecretProviderLabel);
const decodeId = Schema.decodeUnknownOption(SecretProviderId);

export function secretProviderPatch(input: {
  readonly label: string;
  readonly account: string;
  readonly providers: Readonly<Record<string, SecretProviderConfig>>;
  readonly editingId?: SecretProviderId;
}) {
  const label = decodeLabel(input.label.trim());
  const id =
    input.editingId ??
    Option.getOrNull(
      decodeId(
        input.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 64)
          .replace(/-$/, ""),
      ),
    );
  const existing = input.editingId ? input.providers[input.editingId] : undefined;
  if (input.editingId !== undefined && existing === undefined) return null;
  const savedConfig = existing?.kind === "one_password" ? existing.config : null;
  const savedAccount =
    typeof savedConfig === "object" &&
    savedConfig !== null &&
    "account" in savedConfig &&
    typeof savedConfig.account === "string"
      ? savedConfig.account
      : "";
  const account = input.account.trim() || savedAccount;
  if (
    Option.isNone(label) ||
    id === null ||
    (input.editingId === undefined && Object.hasOwn(input.providers, id)) ||
    account.length > 253 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(account)
  )
    return null;
  return {
    secretProviders: {
      [id]: {
        kind: SecretProviderKind.make("one_password"),
        label: label.value,
        config: { account },
      },
    },
  };
}
