import {
  AuthDiagnosticsReadScope,
  AuthFilesystemReadScope,
  AuthOrchestrationReadScope,
  AuthStandardClientScopes,
  AuthTerminalOperateScope,
  AuthTerminalReadScope,
  type AuthGrantScope,
  sessionGrantsScope,
} from "@t3tools/contracts";
import { setPairingTokenOnUrl } from "@t3tools/shared/remote";

export function pairingScopesForSession(
  session: Parameters<typeof sessionGrantsScope>[0] | null,
  selection: ReadonlyArray<AuthGrantScope>,
) {
  if (session === null) return [];
  const granted = selection.filter((scope) => sessionGrantsScope(session, scope));
  if (!granted.includes(AuthTerminalOperateScope) || granted.includes(AuthTerminalReadScope))
    return granted;
  return sessionGrantsScope(session, AuthTerminalReadScope)
    ? [...granted, AuthTerminalReadScope]
    : granted.filter((scope) => scope !== AuthTerminalOperateScope);
}

export function pairingScopePreset(preset: "read" | "standard") {
  return preset === "standard"
    ? AuthStandardClientScopes
    : [
        AuthOrchestrationReadScope,
        AuthFilesystemReadScope,
        AuthDiagnosticsReadScope,
        AuthTerminalReadScope,
      ];
}

export function togglePairingScope(
  current: ReadonlyArray<AuthGrantScope>,
  scope: AuthGrantScope,
  enabled: boolean,
): ReadonlyArray<AuthGrantScope> {
  const next = current.filter((candidate) => candidate !== scope);
  if (!enabled) {
    return scope === AuthTerminalReadScope
      ? next.filter((candidate) => candidate !== AuthTerminalOperateScope)
      : next;
  }
  next.push(scope);
  if (scope === AuthTerminalOperateScope && !next.includes(AuthTerminalReadScope)) {
    next.push(AuthTerminalReadScope);
  }
  return next;
}

export function shareablePairingUrl(address: string, credential: string): string | null {
  try {
    const url = new URL(address);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (["localhost", "[::1]"].includes(url.hostname) || /^127\./.test(url.hostname)) return null;
    if (url.username || url.password) return null;
    url.pathname = "/pair";
    url.search = "";
    url.hash = "";
    return setPairingTokenOnUrl(url, credential).toString();
  } catch {
    return null;
  }
}
