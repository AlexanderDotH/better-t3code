import * as Duration from "effect/Duration";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import type { ServerSettings, ServerSettingsPatch } from "@t3tools/contracts";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { ProjectSettingsNumberRow } from "./ProjectSettingsNumberRow";
import { buildBackgroundActivityOverridePatch } from "./server-controls-settings";
import type { ScopedMobileSettingsTarget } from "./settings-scoped-server";

export function BackgroundActivityOverrides(props: {
  readonly targets: readonly ScopedMobileSettingsTarget[];
  readonly disabledFor: (key: string) => boolean;
  readonly writeEach: (patch: (settings: ServerSettings) => ServerSettingsPatch) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const resolved = props.targets.map((target) =>
    resolveServerBackgroundActivitySettings(target.settings),
  );
  const first = resolved[0];
  if (!first) return null;
  const disabled = props.disabledFor("backgroundActivity");
  return (
    <SettingsSection title={translator.message("mobile.projects.background.overrides")}>
      {(
        [
          "automaticGitFetchInterval",
          "hostPowerMonitorActiveInterval",
          "hostPowerMonitorIdleInterval",
        ] as const
      ).map((key) => (
        <ProjectSettingsNumberRow
          key={key}
          label={translator.message(`mobile.projects.background.${key}`)}
          value={Duration.toSeconds(first[key])}
          mixed={resolved.some(
            (settings) => Duration.toMillis(settings[key]) !== Duration.toMillis(first[key]),
          )}
          minimum={key === "automaticGitFetchInterval" ? 0 : 5}
          disabled={disabled || props.disabledFor(`backgroundActivity.overrides.${key}`)}
          onCommit={(seconds) => {
            if (seconds !== null)
              props.writeEach((settings) =>
                buildBackgroundActivityOverridePatch(settings, {
                  [key]: Duration.seconds(seconds),
                }),
              );
          }}
        />
      ))}
      {(
        [
          "pauseWhenHostLocked",
          "pauseWhenHostLowPower",
          "pauseWhenClientLowPower",
          "pauseWhenOnBattery",
        ] as const
      ).map((key) => (
        <SettingsSwitchRow
          key={key}
          icon="pause"
          label={translator.message(`mobile.projects.background.${key}`)}
          value={resolved.some((settings) => settings[key] !== first[key]) ? null : first[key]}
          disabled={disabled || props.disabledFor(`backgroundActivity.overrides.${key}`)}
          onValueChange={(value) =>
            props.writeEach((settings) =>
              buildBackgroundActivityOverridePatch(settings, { [key]: value }),
            )
          }
        />
      ))}
    </SettingsSection>
  );
}
