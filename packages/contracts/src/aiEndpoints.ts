import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";
import { makeProviderSettingsSchema } from "./settings.ts";

export const LM_STUDIO_BASE_URL = "http://127.0.0.1:1234/v1";

export function normalizeAiEndpointBaseUrl(raw: string): string {
  const value = raw.trim();
  if (value === "") return "";

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS base URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The base URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("The base URL must not contain credentials. Use the API key field instead.");
  }
  if (value.includes("?") || value.includes("#")) {
    throw new Error("The base URL must not contain a query string or fragment.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname || "/v1";
  return url.href;
}

const AiEndpointBaseUrl = TrimmedString.check(
  Schema.makeFilter((value) => {
    try {
      normalizeAiEndpointBaseUrl(value);
      return true;
    } catch (error) {
      return error instanceof Error ? error.message : "Enter a valid HTTP or HTTPS base URL.";
    }
  }),
);

const endpointSettingsFields = {
  enabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
    Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
  ),
  defaultModel: TrimmedString.pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
    Schema.annotateKey({
      title: "Default model",
      description: "Choose a discovered model or enter its exact model ID.",
      providerSettingsForm: {
        control: "select",
        options: { source: "models" },
        allowCustomValue: true,
        clearWhenEmpty: "persist",
      },
    }),
  ),
  customModels: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
    Schema.annotateKey({
      title: "Custom models",
      description: "Additional model IDs not returned by the endpoint.",
      providerSettingsForm: { control: "ordered-string-list", placeholder: "Model ID" },
    }),
  ),
};

const baseUrlSetting = (defaultValue: string) =>
  AiEndpointBaseUrl.pipe(
    Schema.withDecodingDefault(Effect.succeed(defaultValue)),
    Schema.annotateKey({
      title: "Base URL",
      description: "The endpoint must be reachable from this T3 environment.",
      providerSettingsForm: {
        control: "text",
        placeholder: LM_STUDIO_BASE_URL,
        clearWhenEmpty: "persist",
      },
    }),
  );

export const OpenAiCompatibleSettings = makeProviderSettingsSchema(
  { ...endpointSettingsFields, baseUrl: baseUrlSetting("") },
  { order: ["baseUrl", "defaultModel", "customModels"] },
);
export type OpenAiCompatibleSettings = typeof OpenAiCompatibleSettings.Type;

export const LmStudioSettings = makeProviderSettingsSchema(
  { ...endpointSettingsFields, baseUrl: baseUrlSetting(LM_STUDIO_BASE_URL) },
  { order: ["baseUrl", "defaultModel", "customModels"] },
);
export type LmStudioSettings = typeof LmStudioSettings.Type;

export const AiEndpointDiscoveryInput = Schema.Struct({
  refresh: Schema.optionalKey(Schema.Boolean),
});
export type AiEndpointDiscoveryInput = typeof AiEndpointDiscoveryInput.Type;

export const AiEndpointCandidate = Schema.Struct({
  baseUrl: TrimmedNonEmptyString,
  kind: Schema.Literals(["openaiCompatible", "lmstudio"]),
  verified: Schema.Boolean,
  requiresApiKey: Schema.Boolean,
  models: Schema.Array(
    Schema.Struct({ id: TrimmedNonEmptyString, name: Schema.optionalKey(Schema.String) }),
  ),
});
export type AiEndpointCandidate = typeof AiEndpointCandidate.Type;

export const AiEndpointDiscoveryEvent = Schema.Struct({
  status: Schema.Literals(["scanning", "complete"]),
  endpoints: Schema.Array(AiEndpointCandidate),
  scanned: NonNegativeInt,
  total: NonNegativeInt,
  limited: Schema.Boolean,
  message: Schema.optionalKey(Schema.String),
});
export type AiEndpointDiscoveryEvent = typeof AiEndpointDiscoveryEvent.Type;

export class AiEndpointDiscoveryError extends Schema.TaggedError<AiEndpointDiscoveryError>()(
  "AiEndpointDiscoveryError",
  { message: Schema.String },
) {}
