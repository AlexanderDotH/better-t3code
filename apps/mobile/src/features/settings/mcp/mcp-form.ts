import {
  McpEnvironmentVariableName,
  McpHeaderName,
  McpServerDefinition,
  McpServerId,
  type McpProviderRouting,
  type McpSecretValue,
  type McpServerScope,
  type McpServerTransport,
  type ProjectId,
} from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import * as Schema from "effect/Schema";

const isMcpServerId = Schema.is(McpServerId);
const isEnvironmentVariableName = Schema.is(McpEnvironmentVariableName);
const isHeaderName = Schema.is(McpHeaderName);
const decodeMcpServer = Schema.decodeUnknownSync(McpServerDefinition);

export interface ManagementScope {
  readonly scope: McpServerScope;
  readonly projectId: string;
  readonly projectCwd: string;
}

export interface McpSecretDraft {
  readonly rowId: string;
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
  readonly valueRedacted: boolean;
  readonly storedName?: string;
}

export interface McpServerDraft extends ManagementScope {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly providerRouting: McpProviderRouting;
  readonly transport: McpServerTransport;
  readonly command: string;
  readonly cwd: string;
  readonly args: readonly { readonly rowId: string; readonly value: string }[];
  readonly env: readonly McpSecretDraft[];
  readonly url: string;
  readonly headers: readonly McpSecretDraft[];
}

export class ManagementFormError extends Error {
  constructor(readonly messageKey: InterfaceMessageKey) {
    super(messageKey);
  }
}

export const EMPTY_MANAGEMENT_SCOPE: ManagementScope = {
  scope: "global",
  projectId: "",
  projectCwd: "",
};

export function managementScopeInput(selection: ManagementScope) {
  if (selection.scope === "global") return { scope: "global" as const };
  const projectId = selection.projectId.trim();
  const projectCwd = selection.projectCwd.trim();
  if (!projectCwd) throw new ManagementFormError("mobile.mcp.projectRequired");
  return {
    scope: "project" as const,
    ...(projectId ? { projectId: projectId as ProjectId } : {}),
    projectCwd,
  };
}

function secretDrafts(values: Record<string, McpSecretValue>): readonly McpSecretDraft[] {
  return Object.entries(values).map(([name, secret]) => ({
    rowId: name,
    name,
    value: secret.valueRedacted ? "" : secret.value,
    sensitive: secret.sensitive,
    valueRedacted: secret.valueRedacted === true,
    storedName: name,
  }));
}

export function mcpDraftFromServer(server: McpServerDefinition | null): McpServerDraft {
  return {
    ...EMPTY_MANAGEMENT_SCOPE,
    id: server?.id ?? "",
    name: server?.name ?? "",
    enabled: server?.enabled ?? true,
    providerRouting: server?.providerRouting ?? { mode: "all" },
    scope: server?.scope ?? "global",
    projectId: server?.projectId ?? "",
    projectCwd: server?.projectCwd ?? "",
    transport: server?.transport ?? "stdio",
    command: server?.transport === "stdio" ? server.command : "",
    cwd: server?.transport === "stdio" ? (server.cwd ?? "") : "",
    args:
      server?.transport === "stdio"
        ? server.args.map((value, index) => ({ rowId: `arg-${index}`, value }))
        : [],
    env: server?.transport === "stdio" ? secretDrafts(server.env) : [],
    url: server && server.transport !== "stdio" ? server.url : "",
    headers: server && server.transport !== "stdio" ? secretDrafts(server.headers) : [],
  };
}

function secretMap(entries: readonly McpSecretDraft[], kind: "env" | "headers") {
  const names = new Set<string>();
  return Object.fromEntries(
    entries
      .filter((entry) => entry.name.trim() || entry.value || entry.valueRedacted)
      .map((entry) => {
        const name = entry.name.trim();
        if (!(kind === "env" ? isEnvironmentVariableName : isHeaderName)(name)) {
          throw new ManagementFormError("mobile.mcp.secretNameInvalid");
        }
        const comparableName = kind === "headers" ? name.toLowerCase() : name;
        if (names.has(comparableName)) {
          throw new ManagementFormError("mobile.mcp.secretNameDuplicate");
        }
        names.add(comparableName);
        if (entry.valueRedacted && (!entry.sensitive || name !== entry.storedName)) {
          throw new ManagementFormError("mobile.mcp.secretReenter");
        }
        return [
          name,
          {
            value: entry.value,
            sensitive: entry.sensitive,
            ...(entry.valueRedacted ? { valueRedacted: true } : {}),
          } satisfies McpSecretValue,
        ];
      }),
  );
}

export function validateMcpRouting(routing: McpProviderRouting) {
  if (routing.mode === "selected" && routing.instanceIds.length === 0) {
    throw new ManagementFormError("mobile.mcp.providerRequired");
  }
  return routing;
}

export function mcpServerFromDraft(
  draft: McpServerDraft,
  existingIds: readonly string[],
  originalId?: string,
): McpServerDefinition {
  const id = draft.id.trim();
  if (!draft.name.trim()) throw new ManagementFormError("mobile.mcp.nameRequired");
  if (!isMcpServerId(id)) throw new ManagementFormError("mobile.mcp.identifierInvalid");
  if (existingIds.includes(id) && id !== originalId) {
    throw new ManagementFormError("mobile.mcp.identifierDuplicate");
  }
  const base = {
    id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    providerRouting: validateMcpRouting(draft.providerRouting),
    ...managementScopeInput(draft),
  };
  const definition =
    draft.transport === "stdio"
      ? {
          ...base,
          transport: "stdio",
          command: draft.command.trim(),
          ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
          args: draft.args.map((argument) => argument.value),
          env: secretMap(draft.env, "env"),
        }
      : {
          ...base,
          transport: draft.transport,
          url: draft.url.trim(),
          headers: secretMap(draft.headers, "headers"),
        };
  if (draft.transport === "stdio" && !draft.command.trim()) {
    throw new ManagementFormError("mobile.mcp.commandRequired");
  }
  if (draft.transport !== "stdio" && !/^https?:\/\/.+/i.test(draft.url.trim())) {
    throw new ManagementFormError("mobile.mcp.urlInvalid");
  }
  try {
    return decodeMcpServer(definition);
  } catch {
    throw new ManagementFormError("mobile.mcp.invalidConfig");
  }
}

export function validateMcpImportJson(json: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.replace(/^\uFEFF/, ""));
  } catch {
    throw new ManagementFormError("mobile.mcp.invalidJson");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("mcpServers" in parsed) ||
    typeof parsed.mcpServers !== "object" ||
    parsed.mcpServers === null ||
    Array.isArray(parsed.mcpServers)
  ) {
    throw new ManagementFormError("mobile.mcp.invalidImport");
  }
  return JSON.stringify(parsed);
}
