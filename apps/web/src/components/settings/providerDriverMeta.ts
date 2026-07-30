import {
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  CursorSdkSettings,
  GeminiSettings,
  GrokSettings,
  HyperagentSettings,
  KiroAmazonQSettings,
  LocalOpenAiSettings,
  NvidiaNimSettings,
  OpenCodeSettings,
  OpenCodeGoSettings,
  OpenCodeZenSettings,
  OpenRouterSettings,
  ProviderDriverKind,
} from "@t3tools/contracts";
import type * as Schema from "effect/Schema";
import {
  ClaudeAI,
  CursorIcon,
  Gemini,
  GrokIcon,
  HyperagentIcon,
  KiroIcon,
  LocalOpenAiIcon,
  NvidiaIcon,
  type Icon,
  OpenAI,
  OpenCodeIcon,
  OpenRouterIcon,
} from "../Icons";

type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Top;

/**
 * Browser-safe provider definition. This is deliberately shaped like the
 * future provider package client export: the core web app gets a schema with
 * field annotations plus provider-level presentation metadata, then renders
 * settings generically.
 */
export interface ProviderClientDefinition {
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly icon: Icon;
  readonly settingsSchema: ProviderSettingsSchema;
  /**
   * Optional short label rendered as a `variant="warning"` badge next to
   * the instance title. Used to flag drivers that still ship under an
   * early-access or preview gate — the flag is a property of the driver
   * kind (not a specific instance), so every instance of that driver —
   * built-in default or custom — advertises the same marker.
   */
  readonly badgeLabel?: string;
}

const EARLY_ACCESS_BADGE = "Early Access";

export const PROVIDER_CLIENT_DEFINITIONS: readonly ProviderClientDefinition[] = [
  {
    value: ProviderDriverKind.make("codex"),
    label: "Codex",
    icon: OpenAI,
    settingsSchema: CodexSettings,
  },
  {
    value: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    icon: ClaudeAI,
    settingsSchema: ClaudeSettings,
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    icon: CursorIcon,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: CursorSettings,
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    icon: GrokIcon,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: GrokSettings,
  },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    icon: OpenCodeIcon,
    settingsSchema: OpenCodeSettings,
  },
  {
    value: ProviderDriverKind.make("gemini"),
    label: "Gemini",
    icon: Gemini,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: GeminiSettings,
  },
  {
    value: ProviderDriverKind.make("openrouter"),
    label: "OpenRouter",
    icon: OpenRouterIcon,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: OpenRouterSettings,
  },
  {
    value: ProviderDriverKind.make("nvidiaNim"),
    label: "NVIDIA NIM",
    icon: NvidiaIcon,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: NvidiaNimSettings,
  },
  {
    value: ProviderDriverKind.make("localOpenAi"),
    label: "Local OpenAI",
    icon: LocalOpenAiIcon,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: LocalOpenAiSettings,
  },
  {
    value: ProviderDriverKind.make("opencodeZen"),
    label: "OpenCode Zen",
    icon: OpenCodeIcon,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: OpenCodeZenSettings,
  },
  {
    value: ProviderDriverKind.make("opencodeGo"),
    label: "OpenCode Go",
    icon: OpenCodeIcon,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: OpenCodeGoSettings,
  },
  {
    value: ProviderDriverKind.make("kiroAmazonQ"),
    label: "Kiro / Amazon Q",
    icon: KiroIcon,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: KiroAmazonQSettings,
  },
  {
    value: ProviderDriverKind.make("hyperagent"),
    label: "Hyperagent",
    icon: HyperagentIcon,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: HyperagentSettings,
  },
  {
    value: ProviderDriverKind.make("cursorSdk"),
    label: "Cursor SDK",
    icon: CursorIcon,
    badgeLabel: EARLY_ACCESS_BADGE,
    settingsSchema: CursorSdkSettings,
  },
];

export const PROVIDER_CLIENT_DEFINITION_BY_VALUE: Partial<
  Record<ProviderDriverKind, ProviderClientDefinition>
> = Object.fromEntries(
  PROVIDER_CLIENT_DEFINITIONS.map((definition) => [definition.value, definition]),
);

export const DRIVER_OPTIONS = PROVIDER_CLIENT_DEFINITIONS;
export const DRIVER_OPTION_BY_VALUE = PROVIDER_CLIENT_DEFINITION_BY_VALUE;
export type DriverOption = ProviderClientDefinition;

/**
 * Look up the driver metadata for an instance's `driver` field. Accepts
 * Returns `undefined` for fork / unknown drivers so callers can decide how
 * to render them — typically by falling back to a generic card.
 */
export function getDriverOption(driver: ProviderDriverKind | undefined): DriverOption | undefined {
  if (driver === undefined) return undefined;
  return PROVIDER_CLIENT_DEFINITION_BY_VALUE[driver];
}
