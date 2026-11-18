import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

export type SettingsPath =
  | "/settings/better-t3"
  | "/settings/mcp"
  | "/settings/skills"
  | "/settings/import-chats"
  | "/settings/projects"
  | "/settings/general"
  | "/settings/diagnostics"
  | "/settings/appearance"
  | "/settings/chat"
  | "/settings/diffs"
  | "/settings/keybindings"
  | "/settings/snap-shot"
  | "/settings/providers"
  | "/settings/threads"
  | "/settings/browser"
  | "/settings/devices"
  | "/settings/scheduled-tasks"
  | "/settings/source-control"
  | "/settings/worktrees"
  | "/settings/connections"
  | "/settings/access"
  | "/settings/secrets"
  | "/settings/maintenance"
  | "/settings/labs"
  | "/settings/about"
  | "/settings/archived";

export function getSettingsNavGroups(options: {
  readonly secretsFeatureEnabled: boolean;
}): ReadonlyArray<{
  readonly heading: string;
  readonly headingMessageId: InterfaceMessageKey;
  readonly paths: ReadonlyArray<SettingsPath>;
}> {
  return [
    {
      heading: "Better T3",
      headingMessageId: "settings.application.section.betterT3",
      paths: ["/settings/better-t3", "/settings/mcp", "/settings/skills", "/settings/import-chats"],
    },
    {
      heading: "T3 Code",
      headingMessageId: "settings.application.section.t3Code",
      paths: [
        "/settings/general",
        "/settings/appearance",
        "/settings/chat",
        "/settings/diffs",
        "/settings/keybindings",
        "/settings/snap-shot",
      ],
    },
    {
      heading: "Agents",
      headingMessageId: "settings.betterT3.tab.agents",
      paths: [
        "/settings/providers",
        "/settings/threads",
        "/settings/browser",
        "/settings/devices",
        "/settings/scheduled-tasks",
      ],
    },
    {
      heading: "Code",
      headingMessageId: "pullRequest.detail.tab.code",
      paths: ["/settings/projects", "/settings/source-control", "/settings/worktrees"],
    },
    {
      heading: "Connections",
      headingMessageId: "settings.application.section.connections",
      paths: [
        "/settings/connections",
        "/settings/access",
        ...(options.secretsFeatureEnabled ? (["/settings/secrets"] as const) : []),
      ],
    },
    {
      heading: "System",
      headingMessageId: "settings.betterT3.tab.system",
      paths: ["/settings/maintenance", "/settings/labs", "/settings/about", "/settings/archived"],
    },
  ];
}
