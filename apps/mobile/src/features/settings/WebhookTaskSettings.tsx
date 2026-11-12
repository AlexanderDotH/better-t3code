import { useState } from "react";
import { View } from "react-native";
import type {
  EnvironmentId,
  ScheduledTask,
  ScheduledTaskWebhookDeliverySummary,
} from "@t3tools/contracts";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { ProjectSettingsField, ProjectSettingsSelect } from "./ProjectSettingsFields";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import type { ScheduleDraft } from "./scheduledTaskDraft";

export function WebhookSignatureSettings(props: {
  readonly schedule: ScheduleDraft;
  readonly hasSavedSecret: boolean;
  readonly disabled: boolean;
  readonly onChange: (schedule: ScheduleDraft) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const signature = props.schedule.signature;
  const update = (change: Partial<ScheduleDraft>) =>
    props.onChange({ ...props.schedule, ...change, signatureEdited: true });
  return (
    <View>
      <SettingsSwitchRow
        icon="lock"
        label={translator.message("mobile.projects.tasks.requireSignature")}
        subtitle={translator.message("mobile.projects.tasks.signatureDescription")}
        value={signature !== null}
        disabled={props.disabled}
        onValueChange={(enabled) =>
          update({
            signature: enabled
              ? { header: "x-hub-signature-256", prefix: "sha256=", encoding: "hex" }
              : null,
          })
        }
      />
      {signature ? (
        <>
          <ProjectSettingsField
            label={translator.message("mobile.projects.tasks.signatureHeader")}
            value={signature.header}
            disabled={props.disabled}
            onChange={(header) => update({ signature: { ...signature, header } })}
          />
          <ProjectSettingsField
            label={translator.message("mobile.projects.tasks.signaturePrefix")}
            value={signature.prefix}
            disabled={props.disabled}
            onChange={(prefix) => update({ signature: { ...signature, prefix } })}
          />
          <ProjectSettingsSelect
            label={translator.message("mobile.projects.tasks.signatureEncoding")}
            value={signature.encoding}
            options={[
              { value: "hex", label: "hex" },
              { value: "base64", label: "base64" },
            ]}
            disabled={props.disabled}
            onChange={(encoding) => update({ signature: { ...signature, encoding } })}
          />
          <ProjectSettingsField
            label={translator.message("mobile.projects.tasks.signatureSecret")}
            value={props.schedule.signatureSecret}
            secret
            placeholder={
              props.hasSavedSecret ? translator.message("mobile.projects.secretSaved") : undefined
            }
            disabled={props.disabled}
            onChange={(signatureSecret) => update({ signatureSecret })}
          />
        </>
      ) : null}
    </View>
  );
}

export function WebhookDeliveriesSettings(props: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
}) {
  const translator = useMobileInterfaceTranslator();
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-3 py-3">
      <Button
        label={translator.message("mobile.projects.tasks.deliveries")}
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <WebhookDeliveryHistory environmentId={props.environmentId} task={props.task} />
      ) : null}
    </View>
  );
}

function WebhookDeliveryHistory(props: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
}) {
  const translator = useMobileInterfaceTranslator();
  const [selectedId, setSelectedId] = useState<ScheduledTaskWebhookDeliverySummary["id"] | null>(
    null,
  );
  const list = useEnvironmentQuery(
    serverEnvironment.scheduledTaskWebhookDeliveries({
      environmentId: props.environmentId,
      input: { id: props.task.id, acceptAnyOutcome: true },
    }),
  );
  const detail = useEnvironmentQuery(
    selectedId === null
      ? null
      : serverEnvironment.scheduledTaskWebhookDelivery({
          environmentId: props.environmentId,
          input: { id: props.task.id, deliveryId: selectedId, acceptAnyOutcome: true },
        }),
  );
  const delivery = detail.data?.delivery;
  const error = selectedId === null ? list.error : detail.error;
  return (
    <View className="gap-3">
      {error ? <AppText className="text-sm text-danger">{error}</AppText> : null}
      {selectedId !== null ? (
        <Button
          label={translator.message("mobile.projects.tasks.allDeliveries")}
          tone="text"
          onPress={() => setSelectedId(null)}
        />
      ) : null}
      {selectedId !== null && !delivery && !error ? (
        <AppText>{translator.message("common.loading")}</AppText>
      ) : delivery && selectedId !== null ? (
        <>
          <AppText className="text-foreground">
            {delivery.method} · {delivery.outcome} ·{" "}
            {new Date(delivery.receivedAt).toLocaleString()}
          </AppText>
          {delivery.signatureVerified ? (
            <AppText className="text-foreground-muted">
              {translator.message("mobile.projects.tasks.signatureVerified")}
            </AppText>
          ) : null}
          {delivery.error ? (
            <AppText selectable className="text-danger">
              {delivery.error}
            </AppText>
          ) : null}
          {delivery.missingFields.length > 0 ? (
            <AppText selectable>
              {translator.message("mobile.projects.tasks.missingFields", {
                fields: delivery.missingFields.join(", "),
              })}
            </AppText>
          ) : null}
          <DeliveryBlock
            title={translator.message("mobile.projects.tasks.prompt")}
            text={
              delivery.renderedPrompt ??
              translator.message(
                delivery.pendingWindow
                  ? "mobile.projects.tasks.pendingWindow"
                  : "mobile.projects.tasks.noRun",
              )
            }
          />
          <DeliveryBlock
            title={translator.message("mobile.projects.tasks.headers")}
            text={Object.entries(delivery.headers)
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n")}
          />
          <DeliveryBlock
            title={translator.message("mobile.projects.tasks.query")}
            text={delivery.query}
          />
          <DeliveryBlock
            title={translator.message(
              delivery.bodyTruncated
                ? "mobile.projects.tasks.bodyTruncated"
                : "mobile.projects.tasks.body",
            )}
            text={delivery.body}
          />
        </>
      ) : list.data ? (
        list.data.deliveries.length === 0 ? (
          <AppText className="text-foreground-muted">
            {translator.message("mobile.projects.tasks.noDeliveries")}
          </AppText>
        ) : (
          list.data.deliveries.map((entry) => (
            <View key={entry.id} className="gap-1 border-b border-border-subtle py-2">
              <Button
                label={`${entry.method} · ${entry.outcome} · ${new Date(entry.receivedAt).toLocaleString()}`}
                tone="text"
                onPress={() => setSelectedId(entry.id)}
              />
              {entry.error ? (
                <AppText className="text-sm text-foreground-muted">{entry.error}</AppText>
              ) : null}
            </View>
          ))
        )
      ) : !error ? (
        <AppText>{translator.message("common.loading")}</AppText>
      ) : null}
    </View>
  );
}

function DeliveryBlock(props: { readonly title: string; readonly text: string }) {
  return (
    <View className="gap-1">
      <AppText className="text-sm font-t3-semibold text-foreground">{props.title}</AppText>
      <AppText selectable className="rounded-xl bg-subtle p-3 font-mono text-sm text-foreground">
        {props.text}
      </AppText>
    </View>
  );
}
