import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";
import {
  AgentReasoningEffort,
  DEFAULT_AGENT_REASONING_EFFORT,
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  ProviderOptionSelections,
} from "./model.ts";
import { ModelSelection } from "./orchestration.ts";
import { ProviderInstanceConfig, ProviderInstanceId } from "./providerInstance.ts";

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
  timestampFormat: TimestampFormat.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TIMESTAMP_FORMAT)),
  ),
  wordWrap: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

// ── Server Settings (server-authoritative) ────────────────────

export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

const makeBinaryPathSetting = (fallback: string) =>
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
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["binaryPath", "homePath", "shadowHomePath"],
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
        title: "Claude HOME path",
        description:
          "Custom HOME used when running this Claude instance. Keeps .claude.json and .claude separate.",
        providerSettingsForm: { placeholder: "~", clearWhenEmpty: "omit" },
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
    binaryPath: makeBinaryPathSetting("agent").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Cursor agent binary.",
        providerSettingsForm: { placeholder: "agent", clearWhenEmpty: "omit" },
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

export const DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL = Duration.seconds(30);

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

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  enableProviderUpdateChecks: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  automaticGitFetchInterval: Schema.DurationFromMillis.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(Duration.toMillis(DEFAULT_AUTOMATIC_GIT_FETCH_INTERVAL)),
    ),
  ),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("local" as const satisfies ThreadEnvMode)),
  ),
  newWorktreesStartFromOrigin: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  addProjectBaseDirectory: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_GIT_TEXT_GENERATION_MODEL,
      }),
    ),
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

export const ServerSettingsPatch = Schema.Struct({
  // Server settings
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  enableProviderUpdateChecks: Schema.optionalKey(Schema.Boolean),
  automaticGitFetchInterval: Schema.optionalKey(Schema.DurationFromMillis),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvMode),
  newWorktreesStartFromOrigin: Schema.optionalKey(Schema.Boolean),
  addProjectBaseDirectory: Schema.optionalKey(TrimmedString),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  agentEnhancement: Schema.optionalKey(AgentEnhancementSettingsPatch),
  observability: Schema.optionalKey(
    Schema.Struct({
      otlpTracesUrl: Schema.optionalKey(TrimmedString),
      otlpMetricsUrl: Schema.optionalKey(TrimmedString),
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
  sidebarProjectGroupingMode: Schema.optionalKey(SidebarProjectGroupingMode),
  sidebarProjectGroupingOverrides: Schema.optionalKey(
    Schema.Record(TrimmedNonEmptyString, SidebarProjectGroupingMode),
  ),
  sidebarProjectSortOrder: Schema.optionalKey(SidebarProjectSortOrder),
  sidebarThreadSortOrder: Schema.optionalKey(SidebarThreadSortOrder),
  sidebarThreadPreviewCount: Schema.optionalKey(SidebarThreadPreviewCount),
  timestampFormat: Schema.optionalKey(TimestampFormat),
  wordWrap: Schema.optionalKey(Schema.Boolean),
});
export type ClientSettingsPatch = typeof ClientSettingsPatch.Type;
