import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { ListRow } from "../../components/ui/ListRow";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";

const choices = [
  { value: 100, key: "mobile.access.prefer" },
  { value: 50, key: "mobile.access.normal" },
  { value: 25, key: "mobile.access.lessOften" },
  { value: 0, key: "mobile.access.manualOnly" },
] as const;

export function LoadBalancingSection(props: {
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string;
  }>;
}) {
  const translator = useMobileInterfaceTranslator();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const update = useAtomSet(updateMobilePreferencesAtom, { mode: "promiseExit" });
  const enabled =
    AsyncResult.isSuccess(preferences) && (preferences.value.loadBalancingEnabled ?? false);
  const weights = AsyncResult.isSuccess(preferences)
    ? (preferences.value.loadBalancingWeights ?? {})
    : {};
  const [expanded, setExpanded] = useState<EnvironmentId | null>(null);
  const [failed, setFailed] = useState(false);
  if (props.environments.length < 2) return null;
  return (
    <View className="mt-5">
      <SettingsSection
        title={translator.message("mobile.access.loadBalancing")}
        footer={translator.message("mobile.access.loadHint")}
      >
        <SettingsSwitchRow
          icon="server.rack"
          label={translator.message("mobile.access.balanceAutomatically")}
          value={enabled}
          disabled={!AsyncResult.isSuccess(preferences)}
          onValueChange={(value) =>
            void update({ loadBalancingEnabled: value }).then((exit) =>
              setFailed(exit._tag === "Failure"),
            )
          }
        />
        {props.environments.map((environment) => {
          const weight = weights[environment.environmentId] ?? 50;
          const value = weight === 0 ? 0 : weight < 50 ? 25 : weight === 50 ? 50 : 100;
          return (
            <View key={environment.environmentId}>
              <ListRow
                label={environment.environmentLabel}
                detail={translator.message(choices.find((choice) => choice.value === value)!.key)}
                disabled={!enabled}
                onPress={() =>
                  setExpanded(
                    expanded === environment.environmentId ? null : environment.environmentId,
                  )
                }
              />
              {expanded === environment.environmentId
                ? choices.map((choice) => (
                    <ListChoiceRow
                      key={choice.value}
                      label={translator.message(choice.key)}
                      selected={choice.value === value}
                      disabled={!enabled}
                      onPress={() => {
                        void update({
                          transform: (current) => ({
                            loadBalancingWeights: {
                              ...current.loadBalancingWeights,
                              [environment.environmentId]: choice.value,
                            },
                          }),
                        }).then((exit) => setFailed(exit._tag === "Failure"));
                        setExpanded(null);
                      }}
                    />
                  ))
                : null}
            </View>
          );
        })}
        {failed ? (
          <AppText accessibilityRole="alert" className="p-4 text-danger-foreground">
            {translator.message("mobile.access.mutationFailed")}
          </AppText>
        ) : null}
      </SettingsSection>
    </View>
  );
}
