import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  ENVIRONMENT_MACHINE_KINDS,
  resolveEnvironmentMachineKind,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { View } from "react-native";

import {
  EnvironmentMachineSymbol,
  ENVIRONMENT_MACHINE_SYMBOLS,
} from "../../components/EnvironmentMachineSymbol";
import { AppText } from "../../components/ui/AppText";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListRow } from "../../components/ui/ListRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { AccessSheet } from "./AccessSheet";

const labels = {
  server: "mobile.access.icon.server",
  cloud: "mobile.access.icon.cloud",
  linux: "mobile.access.icon.linux",
  desktop: "mobile.access.icon.desktop",
  laptop: "mobile.access.icon.laptop",
  "mac-mini": "mobile.access.icon.mini",
  "mac-studio": "mobile.access.icon.workstation",
} as const;

export function EnvironmentIconSection({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const translator = useMobileInterfaceTranslator();
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState(false);
  const selected = resolveEnvironmentMachineKind(config);
  return (
    <SettingsSection title={translator.message("mobile.access.environmentIcon")}>
      <ListRow
        icon={ENVIRONMENT_MACHINE_SYMBOLS[selected]}
        label={translator.message(labels[selected])}
        disabled={!config || !canWrite}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <AccessSheet
          title={translator.message("mobile.access.environmentIcon")}
          busy={busy}
          onClose={() => setOpen(false)}
        >
          {ENVIRONMENT_MACHINE_KINDS.map((kind) => (
            <View key={kind} className="flex-row items-center gap-2">
              <EnvironmentMachineSymbol
                kind={kind}
                size={28}
                tintColorClassName="accent-foreground"
              />
              <View className="flex-1">
                <ListChoiceRow
                  label={translator.message(labels[kind])}
                  selected={selected === kind}
                  disabled={busy || !canWrite}
                  onPress={() => {
                    if (inFlight.current || !canWrite) return;
                    inFlight.current = true;
                    setBusy(true);
                    void update({
                      environmentId,
                      input: {
                        patch: {
                          environmentIcon:
                            kind === config?.environment.platform.machine ? null : kind,
                        },
                      },
                    }).then((result) => {
                      setError(result._tag !== "Success");
                      if (result._tag === "Success") setOpen(false);
                      setBusy(false);
                      inFlight.current = false;
                    });
                  }}
                />
              </View>
            </View>
          ))}
          {error ? (
            <AppText accessibilityRole="alert" className="text-danger-foreground">
              {translator.message("mobile.access.mutationFailed")}
            </AppText>
          ) : null}
        </AccessSheet>
      ) : null}
    </SettingsSection>
  );
}
