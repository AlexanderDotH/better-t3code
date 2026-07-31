import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";
import { McpSettings, McpServerDefinition } from "./mcp.ts";
import {
  AgentReasoningEffort,
  DEFAULT_AGENT_REASONING_EFFORT,
  DEFAULT_TEXT_GENERATION_MODEL,
  ProviderOptionSelections,
} from "./model.ts";
import { ModelSelection } from "./orchestration.ts";
import { ProviderInstanceConfig, ProviderInstanceId } from "./providerInstance.ts";
import { SkillSettings } from "./skills.ts";

// ── Client Settings (local-only) ───────────────────────────────

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";

export const SidebarProjectGroupingMode = Schema.Literals([
  "repository",
  "repository_path",
  "separate",
]);
export type SidebarProjectGroupingMode = typeof SidebarProjectGroupingMode.Type;
export const DEFAULT_SIDEBAR_PROJECT_GROUPING_MODE: SidebarProjectGroupingMode = "repository";
export const MIN_SIDEBAR_THREAD_PREVIEW_COUNT = 1;
export const MAX_SIDEBAR_THREAD_PREVIEW_COUNT = 15;
export const SidebarThreadPreviewCount = Schema.Int.check(
  Schema.isBetween({
    minimum: MIN_SIDEBAR_THREAD_PREVIEW_COUNT,
    maximum: MAX_SIDEBAR_THREAD_PREVIEW_COUNT,
  }),
);
export type SidebarThreadPreviewCount = typeof SidebarThreadPreviewCount.Type;
export const DEFAULT_SIDEBAR_THREAD_PREVIEW_COUNT: SidebarThreadPreviewCount = 6;
export const MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS = 1;
export const MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS = 90;
export const SidebarAutoSettleAfterDays = Schema.Number.check(
  Schema.isBetween({
    minimum: MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
    maximum: MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  }),
);
export type SidebarAutoSettleAfterDays = typeof SidebarAutoSettleAfterDays.Type;
export const DEFAULT_SIDEBAR_AUTO_SETTLE_AFTER_DAYS: SidebarAutoSettleAfterDays = 3;
export const MIN_GLASS_OPACITY = 40;
export const MAX_GLASS_OPACITY = 100;
export const GlassOpacity = Schema.Int.check(
  Schema.isBetween({
    minimum: MIN_GLASS_OPACITY,
    maximum: MAX_GLASS_OPACITY,
  }),
);
export type GlassOpacity = typeof GlassOpacity.Type;
export const DEFAULT_GLASS_OPACITY: GlassOpacity = 80;
export const EnvironmentIdentificationMode = Schema.Literals(["artwork", "pill", "none"]);
export type EnvironmentIdentificationMode = typeof EnvironmentIdentificationMode.Type;
export const DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE: EnvironmentIdentificationMode = "artwork";

export const VoiceInputOutputLanguage = Schema.Literals(["native", "english"]);
export type VoiceInputOutputLanguage = typeof VoiceInputOutputLanguage.Type;

export const ClientSettingsSchema = Schema.Struct({
  autoOpenPlanSidebar: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  confirmThreadArchive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  dismissedProviderUpdateNotificationKeys: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  diffIgnoreWhitespace: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  experimentalParallelPlanImplementation: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  environmentIdentificationMode: EnvironmentIdentificationMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE)),
  ),
  glassOpacity: GlassOpacity.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_GLASS_OPACITY)),
  ),
  // Model favorites. Historically keyed by provider kind, now
  // widened to `ProviderInstanceId` so users can favorite a specific model
  // on a custom provider instance (e.g. "Codex Personal · gpt-5") without
  // the UI collapsing it into the same bucket as the default Codex. The
  // widening is backward-compatible by construction: prior provider-kind
  // strings satisfy the `ProviderInstanceId` slug schema, so previously
  // persisted favorites decode unchanged and continue to point at the
  // default instance for their kind (because `defaultInstanceIdForDriver(kind)`
  // uses the same slug). The field name is kept as `provider` for storage
  // stability; new call sites should treat the value as an instance id.
  favorites: Schema.Array(
    Schema.Struct({
      provider: ProviderInstanceId,
      model: TrimmedNonEmptyString,
    }),
  ).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  providerModelPreferences: Schema.Record(
    ProviderInstanceId,
    Schema.Struct({
      hiddenModels: Schema.Array(Schema.String).pipe(
        Schema.withDecodingDefault(Effect.succeed([])),
      ),
      modelOrder: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
    }),
  ).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  sidebarAutoSettleAfterDays: Schema.NullOr(SidebarAutoSettleAfterDays).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_AUTO_SETTLE_AFTER_DAYS)),
  ),
  sidebarProjectGroupingMode: SidebarProjectGroupingMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_PROJECT_GROUPING_MODE)),
  ),
  sidebarProjectGroupingOverrides: Schema.Record(
    TrimmedNonEmptyString,
    SidebarProjectGroupingMode,
  ).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_PROJECT_SORT_ORDER)),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_THREAD_SORT_ORDER)),
  ),
  sidebarThreadPreviewCount: SidebarThreadPreviewCount.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_THREAD_PREVIEW_COUNT)),
  ),
  sidebarV2Enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  // Whether `sidebarV2Enabled` reflects an explicit choice in Settings → Beta.
  // Client settings persist as a whole blob, so every user who has ever touched
  // any setting already has `sidebarV2Enabled: false` stored — without this bit
  // there is no way to tell that apart from "left alone", and a channel-derived
  // default could never reach them. Mirrors `updateChannelConfiguredByUser`.
  sidebarV2ConfiguredByUser: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  timestampFormat: TimestampFormat.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TIMESTAMP_FORMAT)),
  ),
  voiceInputOutputLanguage: VoiceInputOutputLanguage.pipe(
    Schema.withDecodingDefault(Effect.succeed("native" as const)),
  ),
  improvePromptBeforeSend: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  wordWrap: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

// ── Server Settings (server-authoritative) ────────────────────

export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

const makeDefaultedTrimmedStringSetting = (fallback: string) =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => Effect.succeed(value || fallback),
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(fallback)),
  );

const makeBinaryPathSetting = makeDefaultedTrimmedStringSetting;

export type ProviderSettingsFormControl = "text" | "password" | "textarea" | "switch";

export interface ProviderSettingsFormAnnotation {
  readonly control?: ProviderSettingsFormControl | undefined;
  readonly placeholder?: string | undefined;
  readonly hidden?: boolean | undefined;
  readonly clearWhenEmpty?: "omit" | "persist" | undefined;
}

export interface ProviderSettingsFormSchemaAnnotation {
  readonly order?: readonly string[] | undefined;
}

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      readonly providerSettingsForm?: ProviderSettingsFormAnnotation | undefined;
      readonly providerSettingsFormSchema?: ProviderSettingsFormSchemaAnnotation | undefined;
    }
  }
}

export type ProviderSettingsOrder<Fields extends Schema.Struct.Fields> = readonly Extract<
  keyof Fields,
  string
>[];

export function makeProviderSettingsSchema<const Fields extends Schema.Struct.Fields>(
  fields: Fields,
  options?: {
    readonly order?: ProviderSettingsOrder<Fields> | undefined;
  },
): Schema.Struct<Fields> {
  return Schema.Struct(fields).pipe(
    Schema.annotate({
      providerSettingsFormSchema:
        options?.order === undefined ? undefined : { order: options.order },
    }),
  );
}

const makeEnabledProviderSetting = (defaultEnabled: boolean) =>
  Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(defaultEnabled)),
    Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
  );

const makeCustomModelsSetting = () =>
  Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
    Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
  );

const makeManualModelIdsSetting = () =>
  Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
    Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
  );

const makeProviderTextSetting = (input: {
  readonly title: string;
  readonly description: string;
  readonly placeholder?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly hidden?: boolean | undefined;
}) =>
  TrimmedString.pipe(
    Schema.withDecodingDefault(Effect.succeed(input.defaultValue ?? "")),
    Schema.annotateKey({
      title: input.title,
      description: input.description,
      providerSettingsForm: {
        placeholder: input.placeholder,
        clearWhenEmpty: "omit",
        hidden: input.hidden,
      },
    }),
  );

const makeProviderDefaultedTextSetting = (input: {
  readonly title: string;
  readonly description: string;
  readonly placeholder: string;
  readonly defaultValue: string;
}) =>
  makeDefaultedTrimmedStringSetting(input.defaultValue).pipe(
    Schema.annotateKey({
      title: input.title,
      description: input.description,
      providerSettingsForm: {
        placeholder: input.placeholder,
        clearWhenEmpty: "omit",
      },
    }),
  );

const makeProviderSecretSetting = (input: {
  readonly title: string;
  readonly description: string;
  readonly placeholder?: string | undefined;
}) =>
  TrimmedString.pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
    Schema.annotateKey({
      title: input.title,
      description: input.description,
      providerSettingsForm: {
        control: "password",
        placeholder: input.placeholder ?? "Optional",
        clearWhenEmpty: "omit",
      },
    }),
  );

const makeProviderSwitchSetting = (input: {
  readonly title: string;
  readonly description: string;
  readonly defaultValue?: boolean | undefined;
}) =>
  Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(input.defaultValue ?? false)),
    Schema.annotateKey({
      title: input.title,
      description: input.description,
      providerSettingsForm: { control: "switch", clearWhenEmpty: "omit" },
    }),
  );

export const CodexSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("codex").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Codex binary used by this instance.",
        providerSettingsForm: { placeholder: "codex", clearWhenEmpty: "omit" },
      }),
    ),
    homePath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "CODEX_HOME path",
        description: "Custom Codex home and config directory.",
        providerSettingsForm: {
          placeholder: "~/.codex",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    shadowHomePath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Shadow home path",
        description:
          "Account-specific Codex home. Keeps auth.json separate while sharing state from CODEX_HOME.",
        providerSettingsForm: {
          placeholder: "~/.codex-t3/personal",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    launchArgs: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Launch arguments",
        description: "Additional CLI arguments passed to codex app-server on session start.",
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "homePath", "shadowHomePath", "launchArgs"],
  },
);
export type CodexSettings = typeof CodexSettings.Type;

export const ClaudeSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("claude").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Claude binary used by this instance.",
        providerSettingsForm: { placeholder: "claude", clearWhenEmpty: "omit" },
      }),
    ),
    homePath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "CLAUDE_CONFIG_DIR path",
        description:
          "Custom Claude home and config directory. Keeps .claude.json and .claude separate.",
        providerSettingsForm: { placeholder: "~/.claude", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    launchArgs: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Launch arguments",
        description: "Additional CLI arguments passed on session start.",
        providerSettingsForm: {
          placeholder: "e.g. --chrome",
          clearWhenEmpty: "omit",
        },
      }),
    ),
  },
  {
    order: ["binaryPath", "homePath", "launchArgs"],
  },
);
export type ClaudeSettings = typeof ClaudeSettings.Type;

export const CursorSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("cursor-agent").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Cursor agent binary.",
        providerSettingsForm: { placeholder: "cursor-agent", clearWhenEmpty: "omit" },
      }),
    ),
    apiEndpoint: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "API endpoint",
        description: "Override the Cursor API endpoint for this instance.",
        providerSettingsForm: {
          placeholder: "https://...",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "apiEndpoint"],
  },
);
export type CursorSettings = typeof CursorSettings.Type;

export const GrokSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("grok").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Grok CLI binary.",
        providerSettingsForm: { placeholder: "grok", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath"],
  },
);
export type GrokSettings = typeof GrokSettings.Type;

export const OpenCodeSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("opencode").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the OpenCode binary.",
        providerSettingsForm: {
          placeholder: "opencode",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    serverUrl: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Server URL",
        description: "Leave blank to let T3 Code spawn the server when needed.",
        providerSettingsForm: {
          placeholder: "http://127.0.0.1:4096",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    serverPassword: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Server password",
        description: "Stored in plain text on disk.",
        providerSettingsForm: {
          control: "password",
          placeholder: "Optional",
          clearWhenEmpty: "omit",
        },
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "serverUrl", "serverPassword"],
  },
);
export type OpenCodeSettings = typeof OpenCodeSettings.Type;

export const GeminiSettings = makeProviderSettingsSchema(
  {
    enabled: makeEnabledProviderSetting(false),
    apiKey: makeProviderSecretSetting({
      title: "Gemini API key",
      description: "Google AI API key used for direct Gemini agent turns.",
      placeholder: "AIza...",
    }),
    customModels: makeCustomModelsSetting(),
  },
  {
    order: ["apiKey"],
  },
);
export type GeminiSettings = typeof GeminiSettings.Type;

export const OpenRouterSettings = makeProviderSettingsSchema(
  {
    enabled: makeEnabledProviderSetting(false),
    apiKey: makeProviderSecretSetting({
      title: "OpenRouter API key",
      description: "Bearer key used for OpenRouter chat-completions requests.",
      placeholder: "sk-or-...",
    }),
    baseUrl: makeProviderDefaultedTextSetting({
      title: "Base URL",
      description: "OpenRouter OpenAI-compatible API root.",
      placeholder: "https://openrouter.ai/api/v1",
      defaultValue: "https://openrouter.ai/api/v1",
    }),
    preferredMaxCatalogContextTokens: makeProviderTextSetting({
      title: "Max catalog context",
      description: "Optional token limit for hiding very large OpenRouter catalog rows.",
      placeholder: "200000",
    }),
    contextCompression: makeProviderSwitchSetting({
      title: "Context compression",
      description: "Allow OpenRouter context-compression plugins on compatible requests.",
    }),
    customModels: makeCustomModelsSetting(),
  },
  {
    order: ["apiKey", "baseUrl", "preferredMaxCatalogContextTokens", "contextCompression"],
  },
);
export type OpenRouterSettings = typeof OpenRouterSettings.Type;

export const NvidiaNimSettings = makeProviderSettingsSchema(
  {
    enabled: makeEnabledProviderSetting(false),
    apiKey: makeProviderSecretSetting({
      title: "NVIDIA NIM API key",
      description: "Bearer key for NVIDIA NIM OpenAI-compatible requests.",
      placeholder: "nvapi-...",
    }),
    baseUrl: makeProviderDefaultedTextSetting({
      title: "Base URL",
      description: "NVIDIA NIM OpenAI-compatible API root.",
      placeholder: "https://integrate.api.nvidia.com/v1",
      defaultValue: "https://integrate.api.nvidia.com/v1",
    }),
    customModels: makeCustomModelsSetting(),
  },
  {
    order: ["apiKey", "baseUrl"],
  },
);
export type NvidiaNimSettings = typeof NvidiaNimSettings.Type;

export const LocalOpenAiSettings = makeProviderSettingsSchema(
  {
    enabled: makeEnabledProviderSetting(false),
    v1BaseUrl: makeProviderTextSetting({
      title: "OpenAI /v1 base URL",
      description: "Local OpenAI-compatible API root, including /v1.",
      placeholder: "http://127.0.0.1:11434/v1",
    }),
    apiKey: makeProviderSecretSetting({
      title: "Bearer token",
      description: "Optional token for local OpenAI-compatible servers.",
    }),
    opencodeServerBase: makeProviderTextSetting({
      title: "OpenCode server URL",
      description: "Optional opencode serve root used for local catalog hints.",
      placeholder: "http://127.0.0.1:4096",
    }),
    opencodeServerUser: makeProviderTextSetting({
      title: "OpenCode username",
      description: "Optional basic-auth user for the OpenCode server.",
      placeholder: "user",
    }),
    opencodeServerPassword: makeProviderSecretSetting({
      title: "OpenCode password",
      description: "Optional basic-auth password for the OpenCode server.",
    }),
    customModels: makeCustomModelsSetting(),
  },
  {
    order: [
      "v1BaseUrl",
      "apiKey",
      "opencodeServerBase",
      "opencodeServerUser",
      "opencodeServerPassword",
    ],
  },
);
export type LocalOpenAiSettings = typeof LocalOpenAiSettings.Type;

export const OpenCodeZenSettings = makeProviderSettingsSchema(
  {
    enabled: makeEnabledProviderSetting(false),
    apiKey: makeProviderSecretSetting({
      title: "OpenCode Zen API key",
      description: "Bearer key from OpenCode Zen.",
    }),
    baseUrl: makeProviderDefaultedTextSetting({
      title: "Base URL",
      description: "OpenCode Zen OpenAI-compatible API root.",
      placeholder: "https://opencode.ai/zen/v1",
      defaultValue: "https://opencode.ai/zen/v1",
    }),
    customModels: makeCustomModelsSetting(),
  },
  {
    order: ["apiKey", "baseUrl"],
  },
);
export type OpenCodeZenSettings = typeof OpenCodeZenSettings.Type;

export const OpenCodeGoSettings = makeProviderSettingsSchema(
  {
    enabled: makeEnabledProviderSetting(false),
    apiKey: makeProviderSecretSetting({
      title: "OpenCode Go API key",
      description: "Bearer key for OpenCode Go subscription models.",
    }),
    baseUrl: makeProviderDefaultedTextSetting({
      title: "Base URL",
      description: "OpenCode Go OpenAI-compatible API root.",
      placeholder: "https://opencode.ai/zen/go/v1",
      defaultValue: "https://opencode.ai/zen/go/v1",
    }),
    customModels: makeCustomModelsSetting(),
  },
  {
    order: ["apiKey", "baseUrl"],
  },
);
export type OpenCodeGoSettings = typeof OpenCodeGoSettings.Type;

export const KiroAmazonQSettings = makeProviderSettingsSchema(
  {
    enabled: makeEnabledProviderSetting(false),
    apiKey: makeProviderSecretSetting({
      title: "Kiro / Amazon Q token",
      description: "Bearer token for q.us-east-1.amazonaws.com agent calls.",
    }),
    profileArn: makeProviderTextSetting({
      title: "Profile ARN",
      description: "Optional profile ARN returned by Amazon Q model discovery.",
      placeholder: "arn:aws:codewhisperer:...",
    }),
    refreshToken: makeProviderSecretSetting({
      title: "Kiro refresh token",
      description: "Optional Kiro desktop refresh token used to obtain a fresh access token.",
    }),
    refreshAuthRegion: makeProviderDefaultedTextSetting({
      title: "Refresh auth region",
      description: "Kiro desktop auth region segment.",
      placeholder: "us-east-1",
      defaultValue: "us-east-1",
    }),
    apiHost: makeProviderDefaultedTextSetting({
      title: "API host",
      description: "Amazon Q Developer API host.",
      placeholder: "https://q.us-east-1.amazonaws.com",
      defaultValue: "https://q.us-east-1.amazonaws.com",
    }),
    customModels: makeCustomModelsSetting(),
  },
  {
    order: ["apiKey", "profileArn", "refreshToken", "refreshAuthRegion", "apiHost"],
  },
);
export type KiroAmazonQSettings = typeof KiroAmazonQSettings.Type;

export const HyperagentSettings = makeProviderSettingsSchema(
  {
    enabled: makeEnabledProviderSetting(false),
    sessionCookie: makeProviderSecretSetting({
      title: "Session cookie",
      description: "Raw __Host-hyperagent_session token.",
    }),
    baseUrl: makeProviderDefaultedTextSetting({
      title: "Base URL",
      description: "Hyperagent web API root.",
      placeholder: "https://hyperagent.com",
      defaultValue: "https://hyperagent.com",
    }),
    model: makeProviderDefaultedTextSetting({
      title: "Model",
      description: "Default Hyperagent model id.",
      placeholder: "sonnet-latest",
      defaultValue: "sonnet-latest",
    }),
    fastMode: makeProviderSwitchSetting({
      title: "Fast mode",
      description: "Use Hyperagent fast mode for this provider instance.",
    }),
    customModels: makeCustomModelsSetting(),
  },
  {
    order: ["sessionCookie", "baseUrl", "model", "fastMode"],
  },
);
export type HyperagentSettings = typeof HyperagentSettings.Type;

export const CursorSdkSettings = makeProviderSettingsSchema(
  {
    enabled: makeEnabledProviderSetting(false),
    apiKey: makeProviderSecretSetting({
      title: "Cursor SDK API key",
      description: "Cursor Integrations API key used by @cursor/sdk.",
      placeholder: "cursor_...",
    }),
    apiEndpoint: makeProviderTextSetting({
      title: "API endpoint",
      description: "Optional Cursor SDK API endpoint override.",
      placeholder: "https://api.cursor.com",
    }),
    manualModelIds: makeManualModelIdsSetting(),
    customModels: makeCustomModelsSetting(),
  },
  {
    order: ["apiKey", "apiEndpoint"],
  },
);
export type CursorSdkSettings = typeof CursorSdkSettings.Type;

export const ObservabilitySettings = Schema.Struct({
  otlpTracesUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  otlpMetricsUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type ObservabilitySettings = typeof ObservabilitySettings.Type;

export const CavemanMode = Schema.Literals(["off", "lite", "full", "ultra"]);
export type CavemanMode = typeof CavemanMode.Type;
export const DEFAULT_CAVEMAN_MODE: CavemanMode = "off";

export const DEEP_THINKING_STEP_COUNT_MIN = 2;
export const DEEP_THINKING_STEP_COUNT_MAX = 8;
export const DEFAULT_DEEP_THINKING_STEP_COUNT = 3;
export const DEEP_THINKING_REFINEMENT_PASSES_MIN = 0;
export const DEEP_THINKING_REFINEMENT_PASSES_MAX = 3;
export const DEFAULT_DEEP_THINKING_REFINEMENT_PASSES = 0;
export const DEEP_THINKING_PARALLEL_BATCH_SIZE_MIN = 1;
export const DEEP_THINKING_PARALLEL_BATCH_SIZE_MAX = 8;
export const DEFAULT_DEEP_THINKING_PARALLEL_BATCH_SIZE = 3;

export const DeepThinkingStepCount = Schema.Int.check(
  Schema.isBetween({
    minimum: DEEP_THINKING_STEP_COUNT_MIN,
    maximum: DEEP_THINKING_STEP_COUNT_MAX,
  }),
);
export type DeepThinkingStepCount = typeof DeepThinkingStepCount.Type;

export const DeepThinkingRefinementPasses = Schema.Int.check(
  Schema.isBetween({
    minimum: DEEP_THINKING_REFINEMENT_PASSES_MIN,
    maximum: DEEP_THINKING_REFINEMENT_PASSES_MAX,
  }),
);
export type DeepThinkingRefinementPasses = typeof DeepThinkingRefinementPasses.Type;

export const DeepThinkingParallelBatchSize = Schema.Int.check(
  Schema.isBetween({
    minimum: DEEP_THINKING_PARALLEL_BATCH_SIZE_MIN,
    maximum: DEEP_THINKING_PARALLEL_BATCH_SIZE_MAX,
  }),
);
export type DeepThinkingParallelBatchSize = typeof DeepThinkingParallelBatchSize.Type;

export const DeepThinkingSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  stepCount: DeepThinkingStepCount.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_DEEP_THINKING_STEP_COUNT)),
  ),
  refinementPasses: DeepThinkingRefinementPasses.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_DEEP_THINKING_REFINEMENT_PASSES)),
  ),
  parallelEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  parallelBatchSize: DeepThinkingParallelBatchSize.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_DEEP_THINKING_PARALLEL_BATCH_SIZE)),
  ),
  forceParallelForDurableProviders: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
});
export type DeepThinkingSettings = typeof DeepThinkingSettings.Type;

export const AgentEnhancementSettings = Schema.Struct({
  cavemanMode: CavemanMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_CAVEMAN_MODE))),
  defaultReasoningEffort: AgentReasoningEffort.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AGENT_REASONING_EFFORT)),
  ),
  deepThinking: DeepThinkingSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type AgentEnhancementSettings = typeof AgentEnhancementSettings.Type;

export const DEFAULT_AGENT_ENHANCEMENT_SETTINGS: AgentEnhancementSettings = Schema.decodeSync(
  AgentEnhancementSettings,
)({});

export const SourceControlWritingStyleMode = Schema.Literals([
  "repo_conventions",
  "conventional_commits",
  "custom",
]);
export type SourceControlWritingStyleMode = typeof SourceControlWritingStyleMode.Type;

export const SourceControlWritingStyleSettings = Schema.Struct({
  mode: SourceControlWritingStyleMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("repo_conventions" as const)),
  ),
  customInstructions: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  followChangeRequestTemplates: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
});
export type SourceControlWritingStyleSettings = typeof SourceControlWritingStyleSettings.Type;

export const SecretSettingValue = Schema.Struct({
  value: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  valueRedacted: Schema.optional(Schema.Boolean),
});
export type SecretSettingValue = typeof SecretSettingValue.Type;

export const AssemblyAiSpeechTranscriptionSettings = Schema.Struct({
  apiKey: SecretSettingValue.pipe(Schema.withDecodingDefault(Effect.succeed({ value: "" }))),
});
export type AssemblyAiSpeechTranscriptionSettings =
  typeof AssemblyAiSpeechTranscriptionSettings.Type;

export const SpeechTranscriptionSettings = Schema.Struct({
  assemblyAi: AssemblyAiSpeechTranscriptionSettings.pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type SpeechTranscriptionSettings = typeof SpeechTranscriptionSettings.Type;

export const DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL = Duration.seconds(30);
export const DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL = Duration.minutes(5);

export const BackgroundActivityProfile = Schema.Literals([
  "balanced",
  "performance",
  "battery-saver",
]);
export type BackgroundActivityProfile = typeof BackgroundActivityProfile.Type;
export const DEFAULT_BACKGROUND_ACTIVITY_PROFILE: BackgroundActivityProfile = "balanced";

export const BackgroundActivityProfileSelection = Schema.Literals([
  "balanced",
  "performance",
  "battery-saver",
  "custom",
]);
export type BackgroundActivityProfileSelection = typeof BackgroundActivityProfileSelection.Type;

export const BackgroundActivityOverrides = Schema.Struct({
  automaticGitFetchInterval: Schema.optionalKey(Schema.DurationFromMillis),
  providerHealthRefreshInterval: Schema.optionalKey(Schema.DurationFromMillis),
  hostPowerMonitorActiveInterval: Schema.optionalKey(Schema.DurationFromMillis),
  hostPowerMonitorIdleInterval: Schema.optionalKey(Schema.DurationFromMillis),
  idleClientTtl: Schema.optionalKey(Schema.DurationFromMillis),
  pauseWhenHostLocked: Schema.optionalKey(Schema.Boolean),
  pauseWhenHostLowPower: Schema.optionalKey(Schema.Boolean),
  pauseWhenClientLowPower: Schema.optionalKey(Schema.Boolean),
  pauseWhenOnBattery: Schema.optionalKey(Schema.Boolean),
});
export type BackgroundActivityOverrides = typeof BackgroundActivityOverrides.Type;

export const BackgroundActivitySettings = Schema.Struct({
  schemaVersion: Schema.Literal(1).pipe(Schema.withDecodingDefault(Effect.succeed(1 as const))),
  profile: BackgroundActivityProfileSelection.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_BACKGROUND_ACTIVITY_PROFILE)),
  ),
  baseProfile: Schema.optionalKey(BackgroundActivityProfile),
  overrides: BackgroundActivityOverrides.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
}).pipe(Schema.withDecodingDefault(Effect.succeed({})));
export type BackgroundActivitySettings = typeof BackgroundActivitySettings.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  enableProviderUpdateChecks: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  backgroundActivity: BackgroundActivitySettings,
  // Legacy flat fields retained for old settings files and old clients. New
  // consumers should resolve `backgroundActivity` instead.
  automaticGitFetchInterval: Schema.DurationFromMillis.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(Duration.toMillis(DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL)),
    ),
  ),
  providerHealthRefreshInterval: Schema.DurationFromMillis.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(Duration.toMillis(DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL)),
    ),
  ),
  backgroundActivityProfile: BackgroundActivityProfile.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_BACKGROUND_ACTIVITY_PROFILE)),
  ),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("local" as const satisfies ThreadEnvMode)),
  ),
  newWorktreesStartFromOrigin: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  addProjectBaseDirectory: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_TEXT_GENERATION_MODEL,
      }),
    ),
  ),
  sourceControlWritingStyle: SourceControlWritingStyleSettings.pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  sourceControlWriterModelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),

  // Legacy single-instance-per-driver settings. Continues to be the source
  // of truth until `providerInstances` (below) lands per-driver migration
  // shims and the server starts hydrating instances from it. Driver-specific
  // schemas live here for the duration of the migration; once each driver
  // owns its config in its own package, this struct shrinks to nothing and
  // is removed entirely.
  providers: Schema.Struct({
    codex: CodexSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    cursor: CursorSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    grok: GrokSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    opencode: OpenCodeSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    gemini: GeminiSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    openrouter: OpenRouterSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    nvidiaNim: NvidiaNimSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    localOpenAi: LocalOpenAiSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    opencodeZen: OpenCodeZenSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    opencodeGo: OpenCodeGoSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    kiroAmazonQ: KiroAmazonQSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    hyperagent: HyperagentSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    cursorSdk: CursorSdkSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  }).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  // New driver-agnostic instance map. Keyed by `ProviderInstanceId`; values
  // are `ProviderInstanceConfig` envelopes. The driver-specific config blob
  // is `Schema.Unknown` at this layer so envelopes with unknown drivers
  // (forks, downgrades, in-flight PR branches) round-trip without loss.
  // See providerInstance.ts for the forward/backward compatibility invariant.
  providerInstances: Schema.Record(ProviderInstanceId, ProviderInstanceConfig).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  agentEnhancement: AgentEnhancementSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  observability: ObservabilitySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  speechTranscription: SpeechTranscriptionSettings.pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  mcp: McpSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  skills: SkillSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

export const ServerSettingsOperation = Schema.Literals([
  "normalize",
  "check-exists",
  "read-file",
  "read-secret",
  "remove-secret",
  "remove-stale-secret",
  "write-secret",
  "write-file",
  "prepare-directory",
]);
export type ServerSettingsOperation = typeof ServerSettingsOperation.Type;

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    operation: ServerSettingsOperation,
    providerInstanceId: Schema.optional(Schema.String),
    environmentVariable: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const provider =
      this.providerInstanceId === undefined ? "" : ` for provider ${this.providerInstanceId}`;
    const variable =
      this.environmentVariable === undefined
        ? ""
        : ` and environment variable ${this.environmentVariable}`;
    return `Server settings ${this.operation} failed${provider}${variable} at ${this.settingsPath}.`;
  }
}

// ── Unified type ─────────────────────────────────────────────────────

export type UnifiedSettings = ServerSettings & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

// ── Server Settings Patch (replace with a Schema.deepPartial if available) ──────────────────────────────────────────

const ModelSelectionPatch = Schema.Struct({
  instanceId: Schema.optionalKey(ProviderInstanceId),
  model: Schema.optionalKey(TrimmedNonEmptyString),
  options: Schema.optionalKey(ProviderOptionSelections),
});

const CodexSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(TrimmedString),
  homePath: Schema.optionalKey(TrimmedString),
  shadowHomePath: Schema.optionalKey(TrimmedString),
  launchArgs: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ClaudeSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(TrimmedString),
  homePath: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
  launchArgs: Schema.optionalKey(TrimmedString),
});

const CursorSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(TrimmedString),
  apiEndpoint: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const GrokSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const OpenCodeSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(TrimmedString),
  serverUrl: Schema.optionalKey(TrimmedString),
  serverPassword: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const GeminiSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  apiKey: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const OpenRouterSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  apiKey: Schema.optionalKey(TrimmedString),
  baseUrl: Schema.optionalKey(TrimmedString),
  preferredMaxCatalogContextTokens: Schema.optionalKey(TrimmedString),
  contextCompression: Schema.optionalKey(Schema.Boolean),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const NvidiaNimSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  apiKey: Schema.optionalKey(TrimmedString),
  baseUrl: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const LocalOpenAiSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  v1BaseUrl: Schema.optionalKey(TrimmedString),
  apiKey: Schema.optionalKey(TrimmedString),
  opencodeServerBase: Schema.optionalKey(TrimmedString),
  opencodeServerUser: Schema.optionalKey(TrimmedString),
  opencodeServerPassword: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const OpenCodeZenSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  apiKey: Schema.optionalKey(TrimmedString),
  baseUrl: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const OpenCodeGoSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  apiKey: Schema.optionalKey(TrimmedString),
  baseUrl: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const KiroAmazonQSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  apiKey: Schema.optionalKey(TrimmedString),
  profileArn: Schema.optionalKey(TrimmedString),
  refreshToken: Schema.optionalKey(TrimmedString),
  refreshAuthRegion: Schema.optionalKey(TrimmedString),
  apiHost: Schema.optionalKey(TrimmedString),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const HyperagentSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  sessionCookie: Schema.optionalKey(TrimmedString),
  baseUrl: Schema.optionalKey(TrimmedString),
  model: Schema.optionalKey(TrimmedString),
  fastMode: Schema.optionalKey(Schema.Boolean),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const CursorSdkSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  apiKey: Schema.optionalKey(TrimmedString),
  apiEndpoint: Schema.optionalKey(TrimmedString),
  manualModelIds: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const DeepThinkingSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  stepCount: Schema.optionalKey(DeepThinkingStepCount),
  refinementPasses: Schema.optionalKey(DeepThinkingRefinementPasses),
  parallelEnabled: Schema.optionalKey(Schema.Boolean),
  parallelBatchSize: Schema.optionalKey(DeepThinkingParallelBatchSize),
  forceParallelForDurableProviders: Schema.optionalKey(Schema.Boolean),
});

const AgentEnhancementSettingsPatch = Schema.Struct({
  cavemanMode: Schema.optionalKey(CavemanMode),
  defaultReasoningEffort: Schema.optionalKey(AgentReasoningEffort),
  deepThinking: Schema.optionalKey(DeepThinkingSettingsPatch),
});

const SecretSettingValuePatch = Schema.Struct({
  value: Schema.optionalKey(TrimmedString),
  valueRedacted: Schema.optionalKey(Schema.Boolean),
});

export const ServerSettingsPatch = Schema.Struct({
  // Server settings
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  enableProviderUpdateChecks: Schema.optionalKey(Schema.Boolean),
  backgroundActivity: Schema.optionalKey(
    Schema.Struct({
      schemaVersion: Schema.optionalKey(Schema.Literal(1)),
      profile: Schema.optionalKey(BackgroundActivityProfileSelection),
      baseProfile: Schema.optionalKey(BackgroundActivityProfile),
      overrides: Schema.optionalKey(BackgroundActivityOverrides),
    }),
  ),
  automaticGitFetchInterval: Schema.optionalKey(Schema.DurationFromMillis),
  providerHealthRefreshInterval: Schema.optionalKey(Schema.DurationFromMillis),
  backgroundActivityProfile: Schema.optionalKey(BackgroundActivityProfile),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvMode),
  newWorktreesStartFromOrigin: Schema.optionalKey(Schema.Boolean),
  addProjectBaseDirectory: Schema.optionalKey(TrimmedString),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  agentEnhancement: Schema.optionalKey(AgentEnhancementSettingsPatch),
  sourceControlWritingStyle: Schema.optionalKey(
    Schema.Struct({
      mode: Schema.optionalKey(SourceControlWritingStyleMode),
      customInstructions: Schema.optionalKey(TrimmedString),
      followChangeRequestTemplates: Schema.optionalKey(Schema.Boolean),
    }),
  ),
  sourceControlWriterModelSelection: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  observability: Schema.optionalKey(
    Schema.Struct({
      otlpTracesUrl: Schema.optionalKey(TrimmedString),
      otlpMetricsUrl: Schema.optionalKey(TrimmedString),
    }),
  ),
  speechTranscription: Schema.optionalKey(
    Schema.Struct({
      assemblyAi: Schema.optionalKey(
        Schema.Struct({
          apiKey: Schema.optionalKey(SecretSettingValuePatch),
        }),
      ),
    }),
  ),
  mcp: Schema.optionalKey(
    Schema.Struct({
      servers: Schema.optionalKey(Schema.Array(McpServerDefinition)),
    }),
  ),
  skills: Schema.optionalKey(
    Schema.Struct({
      disabledSkillIds: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
    }),
  ),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(CodexSettingsPatch),
      claudeAgent: Schema.optionalKey(ClaudeSettingsPatch),
      cursor: Schema.optionalKey(CursorSettingsPatch),
      grok: Schema.optionalKey(GrokSettingsPatch),
      opencode: Schema.optionalKey(OpenCodeSettingsPatch),
      gemini: Schema.optionalKey(GeminiSettingsPatch),
      openrouter: Schema.optionalKey(OpenRouterSettingsPatch),
      nvidiaNim: Schema.optionalKey(NvidiaNimSettingsPatch),
      localOpenAi: Schema.optionalKey(LocalOpenAiSettingsPatch),
      opencodeZen: Schema.optionalKey(OpenCodeZenSettingsPatch),
      opencodeGo: Schema.optionalKey(OpenCodeGoSettingsPatch),
      kiroAmazonQ: Schema.optionalKey(KiroAmazonQSettingsPatch),
      hyperagent: Schema.optionalKey(HyperagentSettingsPatch),
      cursorSdk: Schema.optionalKey(CursorSdkSettingsPatch),
    }),
  ),
  // Whole-map replacement for the new instance config. Patching individual
  // entries is intentionally out of scope: the map is small, and partial
  // patches risk leaving driver-specific config in a half-merged state.
  // The web UI sends a fully-formed map every time it edits this field.
  providerInstances: Schema.optionalKey(Schema.Record(ProviderInstanceId, ProviderInstanceConfig)),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;

export const ClientSettingsPatch = Schema.Struct({
  autoOpenPlanSidebar: Schema.optionalKey(Schema.Boolean),
  confirmThreadArchive: Schema.optionalKey(Schema.Boolean),
  confirmThreadDelete: Schema.optionalKey(Schema.Boolean),
  diffIgnoreWhitespace: Schema.optionalKey(Schema.Boolean),
  experimentalParallelPlanImplementation: Schema.optionalKey(Schema.Boolean),
  environmentIdentificationMode: Schema.optionalKey(EnvironmentIdentificationMode),
  glassOpacity: Schema.optionalKey(GlassOpacity),
  favorites: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        provider: ProviderInstanceId,
        model: TrimmedNonEmptyString,
      }),
    ),
  ),
  providerModelPreferences: Schema.optionalKey(
    Schema.Record(
      ProviderInstanceId,
      Schema.Struct({
        hiddenModels: Schema.Array(Schema.String).pipe(
          Schema.withDecodingDefault(Effect.succeed([])),
        ),
        modelOrder: Schema.Array(Schema.String).pipe(
          Schema.withDecodingDefault(Effect.succeed([])),
        ),
      }),
    ),
  ),
  sidebarAutoSettleAfterDays: Schema.optionalKey(Schema.NullOr(SidebarAutoSettleAfterDays)),
  sidebarProjectGroupingMode: Schema.optionalKey(SidebarProjectGroupingMode),
  sidebarProjectGroupingOverrides: Schema.optionalKey(
    Schema.Record(TrimmedNonEmptyString, SidebarProjectGroupingMode),
  ),
  sidebarProjectSortOrder: Schema.optionalKey(SidebarProjectSortOrder),
  sidebarThreadSortOrder: Schema.optionalKey(SidebarThreadSortOrder),
  sidebarThreadPreviewCount: Schema.optionalKey(SidebarThreadPreviewCount),
  sidebarV2Enabled: Schema.optionalKey(Schema.Boolean),
  sidebarV2ConfiguredByUser: Schema.optionalKey(Schema.Boolean),
  timestampFormat: Schema.optionalKey(TimestampFormat),
  voiceInputOutputLanguage: Schema.optionalKey(VoiceInputOutputLanguage),
  improvePromptBeforeSend: Schema.optionalKey(Schema.Boolean),
  wordWrap: Schema.optionalKey(Schema.Boolean),
});
export type ClientSettingsPatch = typeof ClientSettingsPatch.Type;
