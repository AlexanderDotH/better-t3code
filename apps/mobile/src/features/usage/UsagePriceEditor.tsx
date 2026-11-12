import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  USAGE_PRICE_FIELDS,
  parseUsagePriceForm,
  usagePriceForm,
  type UsagePriceForm,
} from "@t3tools/client-runtime/usage-prices";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { InsightsSheet } from "../diagnostics/InsightsSheet";

export function UsagePriceEditor(props: {
  readonly environments: readonly {
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }[];
  readonly initialModel?: string;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [environmentId, setEnvironmentId] = useState(props.environments[0]?.environmentId);
  return (
    <InsightsSheet
      title={translator.message("mobile.insights.modelPrices")}
      onClose={props.onClose}
    >
      <Text className="text-sm text-foreground-muted">
        {translator.message("mobile.insights.pricingHelp")}
      </Text>
      {props.environments.map((environment) => (
        <Button
          key={environment.environmentId}
          label={`${environment.environmentId === environmentId ? "✓ " : ""}${environment.label}`}
          tone="text"
          onPress={() => setEnvironmentId(environment.environmentId)}
        />
      ))}
      {environmentId ? (
        <EnvironmentPrices
          key={environmentId}
          environmentId={environmentId}
          initialModel={props.initialModel}
        />
      ) : null}
    </InsightsSheet>
  );
}

function EnvironmentPrices(props: {
  readonly environmentId: EnvironmentId;
  readonly initialModel: string | undefined;
}) {
  const translator = useMobileInterfaceTranslator();
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const allowed = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(props.environmentId),
  );
  const [form, setForm] = useState(() =>
    usagePriceForm(
      props.initialModel,
      props.initialModel ? settings?.usagePriceOverrides[props.initialModel] : undefined,
    ),
  );
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const update = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const parsed = parseUsagePriceForm(form);
  const write = async (reset: boolean) => {
    const model = form.model.trim();
    if (!model || (!reset && !parsed) || pending) return;
    setPending(true);
    const result = await update({
      environmentId: props.environmentId,
      input: { patch: { usagePriceOverrides: { [model]: reset ? null : parsed!.price } } },
    }).finally(() => setPending(false));
    setStatus(
      translator.message(
        result._tag === "Success" ? "mobile.insights.saved" : "mobile.insights.saveFailed",
      ),
    );
    if (result._tag === "Success" && reset) setForm(usagePriceForm(model));
  };
  const field = (key: keyof UsagePriceForm, label: string, numeric = false) => (
    <View key={key} className="gap-1">
      <Text className="text-sm text-foreground-muted">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={form[key]}
        editable={allowed && !pending && settings !== null}
        keyboardType={numeric ? "decimal-pad" : "default"}
        autoCapitalize="none"
        autoCorrect={false}
        className="min-h-12 rounded-xl bg-grouped-card px-3 text-base text-foreground"
        onChangeText={(value) => {
          setForm((previous) => ({ ...previous, [key]: value }));
          setStatus(null);
        }}
      />
    </View>
  );
  return (
    <>
      {Object.entries(settings?.usagePriceOverrides ?? {}).map(([model, price]) => (
        <Pressable
          key={model}
          accessibilityRole="button"
          className="min-h-12 justify-center"
          disabled={pending}
          onPress={() => {
            setForm(usagePriceForm(model, price));
            setStatus(null);
          }}
        >
          <Text className="text-base text-primary-text">{model}</Text>
        </Pressable>
      ))}
      {field("model", translator.message("mobile.insights.modelId"))}
      {USAGE_PRICE_FIELDS.map(({ key }) =>
        field(key, translator.message(`mobile.insights.price.${key}`), true),
      )}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={translator.message("settings.common.save")}
          disabled={!allowed || !settings || !parsed || pending}
          loading={pending}
          onPress={() => void write(false)}
        />
        <Button
          label={translator.message("mobile.insights.resetPrice")}
          disabled={!allowed || !settings?.usagePriceOverrides[form.model.trim()] || pending}
          tone="text"
          onPress={() => void write(true)}
        />
      </View>
      {status ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
          {status}
        </Text>
      ) : null}
    </>
  );
}
