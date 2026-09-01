"use client";

import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { useCallback } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ProviderAuthFlow } from "./ProviderSettingsPanel.logic";
import type { ProviderSubscriptionPresentation } from "./ProviderSubscriptionAuth";
import { ProviderSubscriptionAuthControls } from "./ProviderSubscriptionAuthControls";

interface ProviderSubscriptionAuthBridgeProps {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly flow: ProviderAuthFlow;
  readonly readOnly: boolean;
  readonly presentation: ProviderSubscriptionPresentation;
}

function commandFailure(result: { readonly _tag: string }, fallback: string): Error | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result as never)) return null;
  const error = squashAtomCommandFailure(result as never);
  return error instanceof Error ? error : new Error(fallback);
}

export function ProviderSubscriptionAuthBridge({
  environmentId,
  instanceId,
  flow,
  readOnly,
  presentation,
}: ProviderSubscriptionAuthBridgeProps) {
  const event = useAtomValue(
    serverEnvironment.providerAuthConnectEventAtom({ environmentId, instanceId }),
  );
  const connectProviderAuth = useAtomCommand(serverEnvironment.connectProviderAuth, {
    reportFailure: false,
  });
  const setProviderAuthCredential = useAtomCommand(serverEnvironment.setProviderAuthCredential, {
    reportFailure: false,
  });
  const disconnectProviderAuth = useAtomCommand(serverEnvironment.disconnectProviderAuth, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const refresh = useCallback(async () => {
    await refreshProviders({ environmentId, input: {} });
  }, [environmentId, refreshProviders]);

  const onConnect = useCallback(
    async (selectedFlow: ProviderAuthFlow) => {
      const result = await connectProviderAuth({
        environmentId,
        input: { instanceId, flow: selectedFlow },
      });
      const error = commandFailure(result, `${presentation.providerName} sign-in failed.`);
      if (error) throw error;
      await refresh();
    },
    [connectProviderAuth, environmentId, instanceId, presentation.providerName, refresh],
  );

  const onSetCredential = useCallback(
    async (credential: string) => {
      const result = await setProviderAuthCredential({
        environmentId,
        input: { instanceId, credential },
      });
      const error = commandFailure(
        result,
        `Could not save ${presentation.credential?.label ?? "provider credential"}.`,
      );
      if (error) throw error;
      await refresh();
    },
    [environmentId, instanceId, presentation.credential?.label, refresh, setProviderAuthCredential],
  );

  const onDisconnect = useCallback(async () => {
    const result = await disconnectProviderAuth({
      environmentId,
      input: { instanceId },
    });
    const error = commandFailure(result, `Could not disconnect ${presentation.providerName}.`);
    if (error) throw error;
    await refresh();
  }, [disconnectProviderAuth, environmentId, instanceId, presentation.providerName, refresh]);

  return (
    <ProviderSubscriptionAuthControls
      presentation={presentation}
      flow={flow}
      event={event}
      readOnly={readOnly}
      onConnect={onConnect}
      onSetCredential={onSetCredential}
      onDisconnect={onDisconnect}
    />
  );
}
