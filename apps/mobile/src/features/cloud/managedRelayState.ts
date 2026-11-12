import { useAtomValue } from "@effect/atom-react";
import {
  createManagedRelayQueryManager,
  deregisterManagedRelayEnvironment,
  managedRelaySessionAtom,
  managedTunnelCap,
  readManagedRelaySnapshotState,
} from "@t3tools/client-runtime/relay";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type RelayT3ChatLinkResponse,
  type RelayClientEnvironmentRecord,
} from "@t3tools/contracts/relay";
import { AsyncResult, Atom } from "effect/reactivity";

import * as Runtime from "../../lib/runtime";
import { appAtomRegistry } from "../../state/atom-registry";

const managedRelayAtomRuntime = Atom.runtime(Runtime.layer);

const managedRelayQueryManager = createManagedRelayQueryManager(managedRelayAtomRuntime);

const managedRelayMutationScheduler = createAtomCommandScheduler();

export const deregisterManagedRelayEnvironmentCommand = createRuntimeCommand(
  managedRelayAtomRuntime,
  {
    label: "mobile:managed-relay:deregister-environment",
    scheduler: managedRelayMutationScheduler,
    concurrency: {
      mode: "serial",
      key: (input: { readonly accountId: string; readonly environmentId: EnvironmentId }) =>
        input.accountId,
    },
    execute: (input, registry) => deregisterManagedRelayEnvironment(registry, input),
  },
);

const EMPTY_ENVIRONMENTS_ATOM = Atom.make(
  AsyncResult.success<ReadonlyArray<RelayClientEnvironmentRecord>>([]),
).pipe(Atom.keepAlive, Atom.withLabel("managed-relay:mobile:environments:null"));

export function useManagedRelayEnvironments() {
  const session = useAtomValue(managedRelaySessionAtom);
  const accountId = session?.accountId ?? null;
  const atom = accountId
    ? managedRelayQueryManager.environmentsAtom(accountId)
    : EMPTY_ENVIRONMENTS_ATOM;
  const result = useAtomValue(atom);
  const snapshot = readManagedRelaySnapshotState(result);
  const refresh = () => {
    if (accountId) {
      managedRelayQueryManager.refreshEnvironments(appAtomRegistry, accountId);
    }
  };

  return {
    ...snapshot,
    accountId,
    refresh,
  };
}

export function refreshManagedRelayEnvironments(): void {
  const session = appAtomRegistry.get(managedRelaySessionAtom);
  if (session) {
    managedRelayQueryManager.refreshEnvironments(appAtomRegistry, session.accountId);
    managedRelayQueryManager.refreshT3ChatLink(appAtomRegistry, session.accountId);
  }
}

const EMPTY_T3CHAT_ATOM = Atom.make(AsyncResult.initial<RelayT3ChatLinkResponse>());

export function useManagedTunnelUsage() {
  const environments = useManagedRelayEnvironments();
  const result = useAtomValue(
    environments.accountId
      ? managedRelayQueryManager.t3ChatLinkAtom(environments.accountId)
      : EMPTY_T3CHAT_ATOM,
  );
  const account = AsyncResult.getOrElse(result, () => null);
  const limit = account === null ? null : managedTunnelCap(account).limit;
  const used =
    environments.data?.filter(
      (environment) => environment.endpoint.providerKind === "cloudflare_tunnel",
    ).length ?? null;
  return { used, limit };
}
