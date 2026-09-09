import type { CatalogInput, CatalogMcpConnection, ExtensionCatalogEntry } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as NodeCrypto from "node:crypto";

const ValueMetadata = Schema.Struct({
  description: Schema.optional(Schema.String),
  default: Schema.optional(Schema.String),
  isRequired: Schema.optional(Schema.Boolean),
  isSecret: Schema.optional(Schema.Boolean),
});
const RegistryValue = Schema.Struct({
  ...ValueMetadata.fields,
  name: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  variables: Schema.optional(Schema.Record(Schema.String, ValueMetadata)),
});
const RegistryRemote = Schema.Struct({
  type: Schema.String,
  url: Schema.String,
  headers: Schema.optional(Schema.Array(RegistryValue)),
  variables: Schema.optional(Schema.Record(Schema.String, ValueMetadata)),
});
const RegistryPackage = Schema.Struct({
  registryType: Schema.String,
  registryBaseUrl: Schema.optional(Schema.String),
  identifier: Schema.String,
  version: Schema.optional(Schema.String),
  transport: Schema.Struct({ type: Schema.String }),
  runtimeArguments: Schema.optional(Schema.Array(RegistryValue)),
  packageArguments: Schema.optional(Schema.Array(RegistryValue)),
  environmentVariables: Schema.optional(Schema.Array(RegistryValue)),
});
export const RegistryServer = Schema.Struct({
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.String,
  version: Schema.String,
  websiteUrl: Schema.optional(Schema.String),
  repository: Schema.optional(Schema.Struct({ url: Schema.optional(Schema.String) })),
  remotes: Schema.optional(Schema.Array(RegistryRemote)),
  packages: Schema.optional(Schema.Array(RegistryPackage)),
});

export function mcpCatalogEntry(server: typeof RegistryServer.Type): ExtensionCatalogEntry {
  const connections: CatalogMcpConnection[] = [];

  function builder() {
    const inputs = new Map<string, CatalogInput>();
    const variable = (key: string, metadata: typeof ValueMetadata.Type, required = false) => {
      const previous = inputs.get(key);
      inputs.set(key, {
        key,
        label: key,
        description: metadata.description ?? previous?.description ?? "",
        required: required || metadata.isRequired === true || previous?.required === true,
        secret: metadata.isSecret === true || previous?.secret === true,
        defaultValue: metadata.default ?? previous?.defaultValue ?? "",
      });
      return `{${key}}`;
    };
    const template = (
      value: string,
      variables?: (typeof RegistryValue.Type)["variables"],
      metadata: typeof ValueMetadata.Type = {},
    ) =>
      value.replace(/\{([^{}]+)\}/g, (_, key: string) =>
        variable(key, { ...metadata, ...variables?.[key] }, true),
      );
    const value = (entry: typeof RegistryValue.Type, fallback: string) =>
      entry.value !== undefined
        ? template(entry.value, entry.variables, entry)
        : variable(entry.name ?? fallback, entry);
    const fields = (entries: readonly (typeof RegistryValue.Type)[] = [], secret = false) =>
      Object.fromEntries(
        entries
          .filter((entry) => entry.name)
          .map((entry) => [
            entry.name!,
            value({ ...entry, isSecret: secret || entry.isSecret === true }, entry.name!),
          ]),
      );
    return { inputs, template, value, fields };
  }

  for (const remote of server.remotes ?? []) {
    if (remote.type !== "streamable-http" && remote.type !== "sse") continue;
    if (!/^https?:\/\//i.test(remote.url)) continue;
    const build = builder();
    const url = build.template(remote.url, remote.variables);
    const headers = build.fields(remote.headers, true);
    connections.push({
      label: remote.type === "sse" ? "Remote · SSE" : "Remote · HTTP",
      transport: remote.type === "sse" ? "sse" : "http",
      command: "",
      args: [],
      url,
      env: {},
      headers,
      inputs: [...build.inputs.values()],
    });
  }

  for (const pkg of server.packages ?? []) {
    if (pkg.transport.type !== "stdio") continue;
    const npm = pkg.registryType === "npm";
    const pypi = pkg.registryType === "pypi";
    if (!npm && !pypi) continue;
    if (
      pkg.registryBaseUrl &&
      pkg.registryBaseUrl.replace(/\/$/, "") !==
        (npm ? "https://registry.npmjs.org" : "https://pypi.org")
    )
      continue;
    if (
      !(npm ? /^(?:@[\w.-]+\/)?[a-zA-Z0-9][\w.-]*$/ : /^[a-zA-Z0-9][\w.-]*$/).test(pkg.identifier)
    )
      continue;
    if (pkg.version && !/^[a-zA-Z0-9_.+-]+$/.test(pkg.version)) continue;
    const build = builder();
    const args = (entries: readonly (typeof RegistryValue.Type)[] = [], prefix: string) =>
      entries.map((entry, index) => ({
        ...(entry.type === "named" && entry.name ? { name: entry.name } : {}),
        value: build.value(entry, `${prefix}-${index + 1}`),
      }));
    const runtimeArgs = args(pkg.runtimeArguments, "runtime-argument");
    const packageArgs = args(pkg.packageArguments, "argument");
    const env = build.fields(pkg.environmentVariables);
    connections.push({
      label: `${npm ? "Node.js · npm" : "Python · uvx"} · ${pkg.identifier}`,
      transport: "stdio",
      command: npm ? "npx" : "uvx",
      args: [
        ...(npm && !runtimeArgs.some((arg) => arg.value === "-y" || arg.value === "--yes")
          ? [{ value: "-y" }]
          : []),
        ...runtimeArgs,
        { value: `${pkg.identifier}${pkg.version ? `${npm ? "@" : "=="}${pkg.version}` : ""}` },
        ...packageArgs,
      ],
      url: "",
      env,
      headers: {},
      inputs: [...build.inputs.values()],
    });
  }
  const sourceUrl =
    [server.repository?.url, server.websiteUrl].find((url) => url && /^https?:\/\//i.test(url)) ??
    `https://registry.modelcontextprotocol.io/?q=${encodeURIComponent(server.name)}`;
  return {
    id: `mcp-${NodeCrypto.createHash("sha256").update(server.name).digest("hex").slice(0, 32)}`,
    kind: "mcp",
    name: server.title ?? server.name.split("/").at(-1) ?? server.name,
    description: server.description,
    source: server.name,
    sourceUrl,
    version: server.version,
    connections,
  };
}
