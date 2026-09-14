"use client";

import type { EnvironmentId, ProviderInstanceConfig, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderSettingsModelOption } from "@t3tools/client-runtime/providerSettingsForm";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { serverEnvironment } from "../../state/server";
import { AiEndpointDiscovery } from "./AiEndpointDiscovery";
import {
  adoptAiEndpoint,
  aiEndpointBaseUrl,
  aiEndpointBaseUrlError,
} from "./AiEndpointSettings.logic";
import { ProviderSettingsForm } from "./ProviderSettingsForm";
import type { ProviderClientDefinition } from "./providerDriverMeta";
import { useSettingsCommand, useSettingsMutation } from "./useSettingsMutation";

interface AiEndpointSettingsProps {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly definition: ProviderClientDefinition;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly models: ReadonlyArray<ProviderSettingsModelOption>;
  readonly idPrefix: string;
  readonly readOnly: boolean;
}

export function AiEndpointSettings({
  environmentId,
  environmentLabel,
  definition,
  instanceId,
  instance,
  models,
  idPrefix,
  readOnly,
}: AiEndpointSettingsProps) {
  const translate = useInterfaceTranslator().message;
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useSettingsCommand(serverEnvironment.updateSettings);
  const refreshProviders = useSettingsCommand(serverEnvironment.refreshProviders);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<{
    baseUrl: string;
    models: ReadonlyArray<ProviderSettingsModelOption>;
  } | null>(null);
  const config = draft ?? instance.config;
  const baseUrl = aiEndpointBaseUrl(definition.value, config);
  const savedBaseUrl = aiEndpointBaseUrl(definition.value, instance.config);
  const error = aiEndpointBaseUrlError(definition.value, config);
  const save = useSettingsMutation({
    mutationFn: (nextConfig: Record<string, unknown>) =>
      updateSettings({
        environmentId,
        input: {
          patch: {
            providerInstances: {
              ...settings.providerInstances,
              [instanceId]: { ...instance, config: nextConfig },
            },
          },
        },
      }),
    onSuccess: () => setDraft(null),
    onError: (failure) =>
      toastManager.add({
        type: "error",
        title: translate("settings.providers.endpoint.saveFailed"),
        description: failure instanceof Error ? failure.message : undefined,
      }),
  });
  const fetchModels = useSettingsMutation({
    mutationFn: () =>
      refreshProviders({ environmentId, input: { instanceId, refreshModels: true } }),
    onSuccess: ({ providers }) => {
      const provider = providers.find((candidate) => candidate.instanceId === instanceId);
      if (!provider || provider.status === "error") {
        toastManager.add({
          type: "error",
          title: translate("settings.providers.endpoint.fetchModelsFailed"),
          description: provider?.message,
        });
        return;
      }
      if (savedBaseUrl) setDiscoveredModels({ baseUrl: savedBaseUrl, models: provider.models });
    },
    onError: (failure) =>
      toastManager.add({
        type: "error",
        title: translate("settings.providers.endpoint.fetchModelsFailed"),
        description: failure instanceof Error ? failure.message : undefined,
      }),
  });

  return (
    <div inert={save.isPending || fetchModels.isPending}>
      <ProviderSettingsForm
        definition={definition}
        value={config}
        models={
          discoveredModels?.baseUrl === baseUrl
            ? discoveredModels.models
            : baseUrl === savedBaseUrl
              ? models
              : []
        }
        idPrefix={idPrefix}
        variant="settings"
        onChange={(next) => setDraft(next ?? {})}
      />
      <div className="grid gap-3 px-3 py-3 sm:px-4">
        {draft !== null && error ? (
          <p role="alert" className="text-xs text-destructive">
            {translate(error)}
          </p>
        ) : null}
        {draft !== null ? (
          <p className="text-xs text-muted-foreground">
            {translate("settings.providers.endpoint.saveBeforeFetch")}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly || draft !== null || error !== null || fetchModels.isPending}
            onClick={() => fetchModels.mutate()}
          >
            {translate("settings.providers.endpoint.fetchModels")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly}
            onClick={() => setDiscoveryOpen((open) => !open)}
          >
            {translate(
              discoveryOpen
                ? "settings.common.close"
                : "settings.providers.endpoint.discoveryTitle",
            )}
          </Button>
          {draft !== null ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={readOnly}
                onClick={() => {
                  setDraft(null);
                  setDiscoveredModels(null);
                }}
              >
                {translate("settings.common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={readOnly || error !== null || save.isPending}
                onClick={() => {
                  if (readOnly || error) return;
                  save.mutate(draft);
                }}
              >
                {translate("settings.providers.endpoint.saveChanges")}
              </Button>
            </>
          ) : null}
        </div>
        {discoveryOpen ? (
          <AiEndpointDiscovery
            environmentId={environmentId}
            environmentLabel={environmentLabel}
            instances={settings.providerInstances ?? {}}
            readOnly={readOnly}
            onAdopt={(endpoint) => {
              setDraft(adoptAiEndpoint(config, endpoint));
              setDiscoveredModels({
                baseUrl: aiEndpointBaseUrl(definition.value, { baseUrl: endpoint.baseUrl })!,
                models: endpoint.models.map((model) => ({
                  slug: model.id,
                  name: model.name || model.id,
                })),
              });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
