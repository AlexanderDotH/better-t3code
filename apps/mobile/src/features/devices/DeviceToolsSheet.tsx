import { useAtomValue } from "@effect/atom-react";
import type { DeviceActionInput, DeviceDetail, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { View } from "react-native";
import { AppText, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { deviceEnvironment } from "../../state/device";
import { useAtomCommand } from "../../state/use-atom-command";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { ThreadPanelSheet } from "../threads/ThreadPanelSheet";
import type { ThreadDevicePreview } from "./threadDevicePreviews";

type DeviceActionBody = DeviceActionInput extends infer Action
  ? Action extends { type: string }
    ? Omit<Action, "hostId" | "deviceId">
    : never
  : never;

export function DeviceToolsSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly preview: ThreadDevicePreview;
  readonly onClose: () => void;
  readonly overlay: boolean;
  readonly onOverlayChange: (enabled: boolean) => void;
}) {
  const t = useMobileInterfaceTranslator();
  const target = { hostId: props.preview.session.hostId, deviceId: props.preview.session.deviceId };
  const read = useAtomCommand(deviceEnvironment.detail);
  const action = useAtomCommand(deviceEnvironment.action);
  const canAct = useAtomValue(deviceEnvironment.action.permissionAtom(props.environmentId));
  const canRead = useAtomValue(deviceEnvironment.detail.permissionAtom(props.environmentId));
  const [detail, setDetail] = useState<DeviceDetail | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const [appId, setAppId] = useState("");
  const [url, setUrl] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const ios = props.preview.session.platform === "ios";
  const loadDetail = useEffectEvent(
    (environmentId: EnvironmentId, hostId: string, deviceId: string, active: () => boolean) => {
      void read({ environmentId, input: { hostId, deviceId } }).then((result) => {
        if (!active()) return;
        if (result._tag === "Success") setDetail(result.value);
        else setError(t.message("mobile.panels.failed"));
      });
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the selected host device's settings when its tools sheet opens
  useEffect(() => {
    if (!canRead) return;
    let active = true;
    loadDetail(props.environmentId, target.hostId, target.deviceId, () => active);
    return () => {
      active = false;
    };
  }, [props.environmentId, target.hostId, target.deviceId, canRead]);
  const act = async (...bodies: DeviceActionBody[]) => {
    if (busy.current || !canAct) return;
    busy.current = true;
    setPending(true);
    setError(null);
    await (async () => {
      for (const body of bodies) {
        const result = await action({
          environmentId: props.environmentId,
          input: { ...target, ...body },
        });
        if (result._tag === "Failure") {
          setError(t.message("mobile.panels.failed"));
          break;
        }
        setDetail(result.value);
      }
    })().finally(() => {
      busy.current = false;
      setPending(false);
    });
  };
  const disabled = pending || !canAct;
  const foregroundApp = detail?.foregroundApp?.id;
  const validLocation =
    latitude.trim() !== "" &&
    longitude.trim() !== "" &&
    Number.isFinite(Number(latitude)) &&
    Math.abs(Number(latitude)) <= 90 &&
    Number.isFinite(Number(longitude)) &&
    Math.abs(Number(longitude)) <= 180;
  return (
    <ThreadPanelSheet title={t.message("mobile.panels.deviceTools")} onClose={props.onClose}>
      {error ? (
        <AppText selectable className="text-sm text-foreground-muted">
          {error}
        </AppText>
      ) : null}
      {foregroundApp ? (
        <>
          <AppText selectable className="text-sm text-foreground-muted">
            {foregroundApp}
          </AppText>
          <Button
            label={t.message("mobile.panels.relaunch")}
            disabled={disabled}
            onPress={() =>
              void act(
                { type: "terminateApp", appId: foregroundApp },
                { type: "launchApp", appId: foregroundApp },
              )
            }
          />
        </>
      ) : null}
      <AppTextInput
        accessibilityLabel={t.message("mobile.panels.appId")}
        placeholder={t.message("mobile.panels.appId")}
        value={appId}
        onChangeText={setAppId}
        autoCapitalize="none"
        autoCorrect={false}
        className="rounded-xl bg-input px-3 py-3 text-foreground"
      />
      <Button
        label={t.message("mobile.panels.launch")}
        disabled={disabled || !appId.trim()}
        onPress={() => void act({ type: "launchApp", appId: appId.trim() })}
      />
      <AppTextInput
        accessibilityLabel={t.message("mobile.panels.deepLink")}
        placeholder="myapp://"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        className="rounded-xl bg-input px-3 py-3 text-foreground"
      />
      <Button
        label={t.message("mobile.panels.open")}
        disabled={disabled || !url.trim()}
        onPress={() => void act({ type: "openUrl", url: url.trim() })}
      />
      <View className="flex-row gap-2">
        <Button
          label={t.message("mobile.appearance.light")}
          tone="secondary"
          disabled={disabled}
          onPress={() => void act({ type: "setAppearance", value: "light" })}
        />
        <Button
          label={t.message("mobile.appearance.dark")}
          tone="secondary"
          disabled={disabled}
          onPress={() => void act({ type: "setAppearance", value: "dark" })}
        />
      </View>
      <SettingsSwitchRow
        icon="eye"
        label={t.message("mobile.panels.accessibility")}
        value={props.overlay}
        disabled={!canRead}
        onValueChange={props.onOverlayChange}
      />
      <AppText className="font-t3-semibold">{t.message("mobile.panels.location")}</AppText>
      <View className="flex-row gap-2">
        <AppTextInput
          accessibilityLabel={t.message("mobile.panels.latitude")}
          placeholder={t.message("mobile.panels.latitude")}
          value={latitude}
          onChangeText={setLatitude}
          keyboardType="numbers-and-punctuation"
          className="flex-1 rounded-xl bg-input px-3 py-3 text-foreground"
        />
        <AppTextInput
          accessibilityLabel={t.message("mobile.panels.longitude")}
          placeholder={t.message("mobile.panels.longitude")}
          value={longitude}
          onChangeText={setLongitude}
          keyboardType="numbers-and-punctuation"
          className="flex-1 rounded-xl bg-input px-3 py-3 text-foreground"
        />
      </View>
      <Button
        label={t.message("mobile.panels.apply")}
        disabled={disabled || !validLocation}
        onPress={() =>
          void act({
            type: "setLocation",
            latitude: Number(latitude),
            longitude: Number(longitude),
          })
        }
      />
      {ios ? (
        <Button
          label={t.message("mobile.panels.clearLocation")}
          tone="secondary"
          disabled={disabled}
          onPress={() => void act({ type: "clearLocation" })}
        />
      ) : null}
    </ThreadPanelSheet>
  );
}
