import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { View } from "react-native";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import { deviceEnvironment } from "../../state/device";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { threadDeviceChoices } from "./threadDevicePreviews";

export function DevicePicker(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onSelect: (key: string) => void;
}) {
  const t = useMobileInterfaceTranslator();
  const state = useEnvironmentQuery(
    deviceEnvironment.state({ environmentId: props.environmentId, input: {} }),
  );
  const list = useAtomCommand(deviceEnvironment.list);
  const open = useAtomCommand(deviceEnvironment.open);
  const canList = useAtomValue(deviceEnvironment.list.permissionAtom(props.environmentId));
  const canOpen = useAtomValue(deviceEnvironment.open.permissionAtom(props.environmentId));
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const choices = threadDeviceChoices(state.data, props.threadId);
  const run = async (key?: string) => {
    if (busy.current) return;
    const choice = choices.find((entry) => entry.key === key);
    if (choice?.open) {
      props.onSelect(choice.key);
      return;
    }
    if (choice?.booting || (choice ? !canOpen : !canList)) return;
    busy.current = true;
    setPending(key ?? "discover");
    setError(null);
    await (async () => {
      const result = choice
        ? await open({
            environmentId: props.environmentId,
            input: {
              threadId: props.threadId,
              hostId: choice.device.hostId,
              deviceId: choice.device.id,
              platform: choice.device.platform,
              boot: true,
            },
          })
        : await list({ environmentId: props.environmentId, input: {} });
      if (result._tag === "Success" && choice) props.onSelect(choice.key);
      else if (result._tag === "Failure") setError(t.message("mobile.panels.failed"));
    })().finally(() => {
      busy.current = false;
      setPending(null);
    });
  };
  return (
    <View className="gap-3 p-4">
      <Button
        label={t.message("mobile.panels.discover")}
        disabled={pending !== null || !canList}
        loading={pending === "discover"}
        onPress={() => void run()}
      />
      {(error ?? state.error) ? (
        <AppText selectable className="text-sm text-foreground-muted">
          {error ?? state.error}
        </AppText>
      ) : null}
      {choices.length === 0 ? (
        <AppText className="text-sm text-foreground-muted">
          {t.message("mobile.panels.noDevices")}
        </AppText>
      ) : null}
      {choices.map((choice) => (
        <ListRow
          key={choice.key}
          icon="iphone"
          label={choice.device.name}
          description={[
            choice.host?.label,
            choice.device.version,
            t.message(
              choice.booting || pending === choice.key
                ? "mobile.panels.booting"
                : choice.open || choice.device.booted
                  ? "mobile.panels.open"
                  : "mobile.panels.boot",
            ),
          ]
            .filter(Boolean)
            .join(" · ")}
          disabled={pending !== null || choice.booting || (!choice.open && !canOpen)}
          onPress={() => void run(choice.key)}
        />
      ))}
    </View>
  );
}
