import {
  McpServerDefinition,
  type CatalogMcpConnection,
  type ExtensionCatalogEntry,
  type McpProviderRouting,
  type ProjectId,
  type SkillMutationScope,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
const decodeMcpServer = Schema.decodeUnknownSync(McpServerDefinition);

export function catalogSourceUrl(source: string): string | null {
  try {
    const url = new URL(source);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function catalogMcpServer(input: {
  entry: ExtensionCatalogEntry;
  connection: CatalogMcpConnection;
  values: Readonly<Record<string, string>>;
  scope: SkillMutationScope;
  projectId?: ProjectId;
  projectCwd?: string;
  providerRouting: McpProviderRouting;
}): McpServerDefinition {
  const { connection, values } = input;
  for (const field of connection.inputs) {
    if (field.required && !(values[field.key] ?? field.defaultValue).trim()) {
      throw new Error(`${field.label} is required.`);
    }
  }
  const interpolate = (template: string) =>
    template.replace(
      /\{([^{}]+)\}/g,
      (_, key: string) =>
        values[key] ?? connection.inputs.find((field) => field.key === key)?.defaultValue ?? "",
    );
  const fields = (templates: Readonly<Record<string, string>>) =>
    Object.fromEntries(
      Object.entries(templates).flatMap(([key, template]) => {
        const value = interpolate(template);
        if (!value) return [];
        return [
          [
            key,
            {
              value,
              sensitive: connection.inputs.some(
                (field) => field.secret && template.includes(`{${field.key}}`),
              ),
            },
          ],
        ];
      }),
    );
  return decodeMcpServer({
    id: input.entry.id,
    name: input.entry.name.slice(0, 128),
    scope: input.scope,
    enabled: true,
    providerRouting: input.providerRouting,
    ...(input.scope === "project"
      ? { projectId: input.projectId, projectCwd: input.projectCwd }
      : {}),
    ...(connection.transport === "stdio"
      ? {
          transport: "stdio",
          command: connection.command,
          args: connection.args.flatMap((arg) => {
            const value = interpolate(arg.value);
            return value ? [...(arg.name ? [arg.name] : []), value] : [];
          }),
          env: fields(connection.env),
        }
      : {
          transport: connection.transport,
          url: interpolate(connection.url),
          headers: fields(connection.headers),
        }),
  });
}
