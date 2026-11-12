import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentCloudSettingsAtoms } from "@t3tools/client-runtime/state/cloud-settings";
import {
  AuthRelayReadScope,
  type EnvironmentId,
  managedCapabilityDenial,
} from "@t3tools/contracts";
import { useRef, useState } from "react";

import { AppText } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { hasCloudPublicConfig } from "./publicConfig";
import { TunnelUsageMeter } from "./TunnelUsageMeter";

const cloudSettings = createEnvironmentCloudSettingsAtoms(connectionAtomRuntime);

export function EnvironmentCloudSettingsSection({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const translator = useMobileInterfaceTranslator();
  const canRead = useEnvironmentScope(environmentId, AuthRelayReadScope);
  const canWrite = useAtomValue(cloudSettings.preferences.permissionAtom(environmentId));
  const config = useEnvironmentServerConfig(environmentId);
  const denial = managedCapabilityDenial(config?.managedPolicy, "connect");
  const state = useEnvironmentQuery(
    canRead ? cloudSettings.state({ environmentId, input: null }) : null,
  );
  const update = useAtomCommand(cloudSettings.preferences, {
    reportFailure: false,
    reportDefect: false,
  });
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const linked = state.data?.linked === true && state.data.linkRevoked !== true;
  const disabled = !canWrite || !linked || busy || state.isPending || denial !== undefined;
  async function change(patch: {
    readonly publishAgentActivity?: boolean;
    readonly holdWebhooksWhileOffline?: boolean;
  }) {
    if (inFlight.current || disabled || !state.data) return;
    inFlight.current = true;
    setBusy(true);
    const result = await update({
      environmentId,
      input: { publishAgentActivity: state.data.publishAgentActivity, ...patch },
    });
    setError(result._tag !== "Success");
    setBusy(false);
    inFlight.current = false;
  }
  if (!canRead) return null;
  return (
    <SettingsSection
      title="T3 Connect"
      footer={denial ?? (!linked ? translator.message("mobile.access.linkOnHost") : undefined)}
    >
      {state.error ? (
        <ListActionRow
          icon="arrow.clockwise"
          label={translator.message("mobile.access.loadFailed")}
          onPress={state.refresh}
        />
      ) : state.data ? (
        <>
          <SettingsSwitchRow
            icon="cloud"
            label="T3 Connect"
            value={linked && (state.data.managedTunnelActive ?? state.data.linked)}
            disabled
            subtitle={translator.message("mobile.access.tunnelOnHost")}
            onValueChange={() => undefined}
          />
          <SettingsSwitchRow
            icon="bell.badge"
            label={translator.message("mobile.access.publishActivity")}
            subtitle={translator.message("mobile.access.publishActivityHint")}
            value={state.data.publishAgentActivity}
            disabled={disabled}
            onValueChange={(value) => void change({ publishAgentActivity: value })}
          />
          <SettingsSwitchRow
            icon="clock"
            label={translator.message("mobile.access.holdWebhooks")}
            subtitle={translator.message("mobile.access.holdWebhooksHint")}
            value={state.data.holdWebhooksWhileOffline ?? false}
            disabled={disabled || !(state.data.managedTunnelActive ?? state.data.linked)}
            onValueChange={(value) => void change({ holdWebhooksWhileOffline: value })}
          />
        </>
      ) : (
        <AppText className="p-4 text-foreground-muted">
          {translator.message("mobile.access.loading")}
        </AppText>
      )}
      {hasCloudPublicConfig() ? <TunnelUsageMeter /> : null}
      {error ? (
        <AppText accessibilityRole="alert" className="p-4 text-danger-foreground">
          {translator.message("mobile.access.mutationFailed")}
        </AppText>
      ) : null}
    </SettingsSection>
  );
}
