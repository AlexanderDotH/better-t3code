import type {
  EnvironmentId,
  McpServerDefinition,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ServerProvider,
  ThreadId,
  TurnId,
  VcsStatusResult,
} from "@t3tools/contracts";
import type { ReactNode, RefObject } from "react";

import type { ChatComposerHandle } from "../chat/ChatComposer";
import type { WorkspaceDeckPosition } from "../workspace-deck/workspaceCardDeck.logic";
import type { GitCompactStatus } from "./GitCompactCard";

export interface GitWorkspaceDeckControllerProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly threadId: ThreadId | null;
  readonly turnId: TurnId | null;
  readonly workbenchSupported: boolean;
  readonly legacyStatus: VcsStatusResult | null;
  readonly legacyStatusPending: boolean;
  readonly actionRequired: boolean;
  readonly activeTurn: boolean;
  readonly isRecording: boolean;
  readonly composerRef: RefObject<ChatComposerHandle | null>;
  readonly mcpAuthorizationAvailable: boolean;
  readonly mcpConfiguredServers: readonly McpServerDefinition[];
  readonly mcpProviderAccentColor?: string;
  readonly mcpProviderDisplayName: string;
  readonly mcpProviderDriver: ProviderDriverKind | null;
  readonly mcpProviderInstanceId: ProviderInstanceId | null;
  readonly mcpProviders: readonly ServerProvider[];
  readonly mcpRuntimeSessionId: RuntimeSessionId | null;
  readonly mcpWorkspaceSupported: boolean;
  readonly renderChat: (controls: GitWorkspaceDeckChatControls) => ReactNode;
  readonly renderGitPeek: (controls: GitWorkspaceDeckGitPeekControls) => ReactNode;
  readonly drawerAvailableHeight?: number;
  readonly onOpenFile: (relativePath: string) => void;
  readonly onNonChatActiveChange: (nonChatActive: boolean) => void;
  readonly onExpandedChange: (expanded: boolean) => void;
}

export interface GitWorkspaceDeckChatControls {
  readonly deckEnabled: boolean;
  readonly gitAvailable: boolean;
}

export interface GitWorkspaceDeckGitPeekControls {
  readonly blocked: boolean;
  readonly position: Extract<WorkspaceDeckPosition, "previous" | "next">;
  readonly status: GitCompactStatus;
}
