import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpenCodeClient } from "@opencode/client/effect";
import { Mcp } from "@opencode/schema/mcp";
import { McpRuntimeError } from "@t3tools/contracts";
import type { OpenCodeMcpServerConfig } from "@t3tools/provider-core/server/mcpConfiguration";
import * as Effect from "effect/Effect";
import type { OpenCodeMcpClient } from "./OpenCodeMcpRuntime.ts";
import { runOpenCodeSdk } from "./OpenCodeRuntime.ts";

const providerError = (cause: unknown) =>
  new McpRuntimeError({
    code: "provider-error",
    detail: "OpenCode could not complete the MCP request.",
    cause,
  });
const clean = (value: string, limit: number, fallback: string) =>
  value.trim().slice(0, limit) || fallback;

export function createOpenCode1McpClient(
  client: OpencodeClient,
  directory: string,
): OpenCodeMcpClient {
  const sdk = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
    runOpenCodeSdk(operation, run).pipe(Effect.mapError(providerError));
  return {
    statuses: sdk("mcp.status", (signal) =>
      client.mcp.status({ directory }, { signal, throwOnError: true }),
    ).pipe(
      Effect.map((response) =>
        Object.entries(response.data).map(([name, status]) => ({
          name,
          ...status,
          canAuthorize:
            status.status === "needs_auth" || status.status === "needs_client_registration",
        })),
      ),
    ),
    details: (name) =>
      sdk("experimental.resource.list", (signal) =>
        client.experimental.resource.list({ directory }, { signal, throwOnError: true }),
      ).pipe(
        Effect.map((response) => ({
          resources: Object.values(response.data)
            .filter((resource) => resource.client === name && resource.uri.trim().length > 0)
            .map((resource) => ({
              uri: resource.uri.slice(0, 8_192),
              name: clean(resource.name, 512, "Resource"),
              ...(resource.description === undefined
                ? {}
                : { description: resource.description.slice(0, 65_536) }),
              ...(resource.mimeType?.trim() ? { mimeType: resource.mimeType.slice(0, 512) } : {}),
            })),
          templates: [],
        })),
      ),
    reconnect: Effect.fn("OpenCodeMcpClient.reconnect")(function* (name, checkCurrent) {
      yield* sdk("mcp.disconnect", (signal) =>
        client.mcp.disconnect({ name, directory }, { signal, throwOnError: true }),
      );
      yield* checkCurrent;
      yield* sdk("mcp.connect", (signal) =>
        client.mcp.connect({ name, directory }, { signal, throwOnError: true }),
      );
    }),
    authorize: Effect.fn("OpenCodeMcpClient.authorize")(function* (name, checkCurrent) {
      yield* checkCurrent;
      const response = yield* sdk("mcp.auth.start", (signal) =>
        client.mcp.auth.start({ name, directory }, { signal, throwOnError: true }),
      );
      return response.data.authorizationUrl;
    }),
    applyConfiguration: Effect.fn("OpenCodeMcpClient.applyConfiguration")(
      function* (next, previous, checkCurrent) {
        for (const name of Object.keys(previous)) {
          if (Object.hasOwn(next, name)) continue;
          yield* checkCurrent;
          yield* sdk("mcp.disconnect", (signal) =>
            client.mcp.disconnect({ name, directory }, { signal, throwOnError: true }),
          );
        }
        for (const [name, config] of Object.entries(next)) {
          yield* checkCurrent;
          yield* sdk("mcp.add", (signal) =>
            client.mcp.add({ name, config, directory }, { signal, throwOnError: true }),
          );
          yield* checkCurrent;
          yield* sdk("mcp.connect", (signal) =>
            config.enabled === false
              ? client.mcp.disconnect({ name, directory }, { signal, throwOnError: true })
              : client.mcp.connect({ name, directory }, { signal, throwOnError: true }),
          );
        }
      },
    ),
  };
}

export function toOpenCode2McpConfig(config: OpenCodeMcpServerConfig) {
  return config.type === "local"
    ? new Mcp.LocalConfig({
        type: "local",
        command: config.command,
        disabled: config.enabled === false,
        ...(config.environment === undefined ? {} : { environment: config.environment }),
      })
    : new Mcp.RemoteConfig({
        type: "remote",
        url: config.url,
        disabled: config.enabled === false,
        oauth: false,
        ...(config.headers === undefined ? {} : { headers: config.headers }),
      });
}

export function createOpenCode2McpClient(
  client: () => OpenCodeClient,
  directory: () => string,
): OpenCodeMcpClient {
  const location = () => ({ directory: directory() });
  return {
    statuses: Effect.suspend(() => client().mcp.list({ location: location() })).pipe(
      Effect.mapError(providerError),
      Effect.map((response) =>
        response.data.map((server) => ({
          name: server.name,
          ...server.status,
          canAuthorize: server.status.status === "needs_auth" && server.integrationID !== undefined,
        })),
      ),
    ),
    details: (name) =>
      Effect.suspend(() => client().mcp.resource.catalog({ location: location() })).pipe(
        Effect.mapError(providerError),
        Effect.map((response) => ({
          resources: response.data.resources
            .filter((resource) => resource.server === name && resource.uri.trim().length > 0)
            .map((resource) => ({
              uri: resource.uri.slice(0, 8_192),
              name: clean(resource.name, 512, "Resource"),
              ...(resource.description === undefined
                ? {}
                : { description: resource.description.slice(0, 65_536) }),
              ...(resource.mimeType?.trim() ? { mimeType: resource.mimeType.slice(0, 512) } : {}),
            })),
          templates: response.data.templates
            .filter(
              (template) => template.server === name && template.uriTemplate.trim().length > 0,
            )
            .map((template) => ({
              uriTemplate: template.uriTemplate.slice(0, 8_192),
              name: clean(template.name, 512, "Resource"),
              ...(template.description === undefined
                ? {}
                : { description: template.description.slice(0, 65_536) }),
              ...(template.mimeType?.trim() ? { mimeType: template.mimeType.slice(0, 512) } : {}),
            })),
        })),
      ),
    reconnect: Effect.fn("OpenCode2McpClient.reconnect")(function* (name, checkCurrent) {
      yield* client()
        .mcp.disconnect({ server: name, location: location() })
        .pipe(Effect.mapError(providerError));
      yield* checkCurrent;
      yield* client()
        .mcp.connect({ server: name, location: location() })
        .pipe(Effect.mapError(providerError));
    }),
    authorize: Effect.fn("OpenCode2McpClient.authorize")(function* (name, checkCurrent) {
      const servers = yield* client()
        .mcp.list({ location: location() })
        .pipe(Effect.mapError(providerError));
      const server = servers.data.find((candidate) => candidate.name === name);
      if (server?.integrationID === undefined)
        return yield* new McpRuntimeError({
          code: "authorization-unavailable",
          detail: "OpenCode did not expose an OAuth integration for this MCP server.",
        });
      const integration = yield* client()
        .integration.get({ integrationID: server.integrationID, location: location() })
        .pipe(Effect.mapError(providerError));
      const method = integration.data.methods.find((candidate) => candidate.type === "oauth");
      if (method === undefined)
        return yield* new McpRuntimeError({
          code: "authorization-unavailable",
          detail: "OpenCode did not expose an OAuth method for this MCP server.",
        });
      yield* checkCurrent;
      const attempt = yield* client()
        .integration.oauth.connect({
          integrationID: server.integrationID,
          methodID: method.id,
          location: location(),
        })
        .pipe(Effect.mapError(providerError));
      return attempt.data.url;
    }),
    applyConfiguration: Effect.fn("OpenCode2McpClient.applyConfiguration")(
      function* (next, previous, checkCurrent) {
        for (const name of Object.keys(previous)) {
          if (Object.hasOwn(next, name)) continue;
          yield* checkCurrent;
          yield* client()
            .mcp.remove({ server: name, location: location() })
            .pipe(
              Effect.catchTags({ McpServerNotFoundError: () => Effect.void }),
              Effect.mapError(providerError),
            );
        }
        for (const [name, config] of Object.entries(next)) {
          yield* checkCurrent;
          yield* client()
            .mcp.add({ server: name, config: toOpenCode2McpConfig(config), location: location() })
            .pipe(Effect.mapError(providerError));
        }
      },
    ),
  };
}
