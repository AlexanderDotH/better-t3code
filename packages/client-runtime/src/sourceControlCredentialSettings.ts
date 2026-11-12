import type { SourceControlProviderAuth } from "@t3tools/contracts";
import type { HostCredentialSettings } from "@t3tools/source-control-core/shared/definition";

export type DiscoveredAccount = NonNullable<SourceControlProviderAuth["accounts"]>[number];

export interface HostAccountGroup {
  readonly host: string;
  readonly activeAccount: string | null;
  readonly selectable: ReadonlyArray<string>;
  readonly broken: ReadonlyArray<DiscoveredAccount>;
  readonly environmentVariable: string | null;
}

export function groupHostAccounts(
  accounts: ReadonlyArray<DiscoveredAccount>,
): ReadonlyArray<HostAccountGroup> {
  return [...new Set(accounts.map((entry) => entry.host))].map((host) => {
    const entries = accounts.filter((entry) => entry.host === host);
    const stored = entries.filter((entry) => entry.environmentVariable === undefined);
    const selectable = stored.filter((entry) => entry.authenticated);
    return {
      host,
      activeAccount: (selectable.find((entry) => entry.active) ?? selectable[0])?.account ?? null,
      selectable: selectable.map((entry) => entry.account),
      broken: stored.filter((entry) => !entry.authenticated),
      environmentVariable:
        entries.find((entry) => entry.environmentVariable)?.environmentVariable ?? null,
    };
  });
}

export function nextHostAccountChoices(
  current: HostCredentialSettings["hosts"],
  host: string,
  change: { readonly enabled?: boolean; readonly account?: string | null },
): HostCredentialSettings["hosts"] {
  const previous = current[host];
  const enabled = change.enabled ?? previous?.enabled ?? true;
  const account = change.account === undefined ? previous?.account : (change.account ?? undefined);
  const { [host]: _replaced, ...rest } = current;
  if (enabled && account === undefined) return rest;
  return { ...rest, [host]: { enabled, ...(account === undefined ? {} : { account }) } };
}

export function normalizedCredentialHost(value: string): string | null {
  const host = value.trim().toLowerCase();
  if (!host || /[\s/@?#\\]/.test(host) || host.includes("://")) return null;
  try {
    const url = new URL(`https://${host}`);
    return url.host === host && url.pathname === "/" ? host : null;
  } catch {
    return null;
  }
}

export function hostTokenSettingsPatch(input: {
  readonly kind: string;
  readonly host: string;
  readonly token: string;
  readonly tokens: HostCredentialSettings["tokens"];
}) {
  const host = normalizedCredentialHost(input.host);
  return host === null
    ? null
    : {
        sourceControlHosts: {
          [input.kind]: { tokens: { ...input.tokens, [host]: input.token.trim() } },
        },
      };
}

export function directCredentialSettingsPatch(
  kind: string,
  fields: Readonly<Record<string, string>>,
) {
  const allowed =
    kind === "bitbucket"
      ? ["accessToken", "email", "apiToken"]
      : kind === "gitcafe"
        ? ["token"]
        : [];
  const entries = Object.entries(fields);
  if (entries.length === 0 || entries.some(([field]) => !allowed.includes(field))) return null;
  const email = fields.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return {
    sourceControlHosts: {
      [kind]: Object.fromEntries(entries.map(([field, value]) => [field, value.trim()])),
    },
  };
}
