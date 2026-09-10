"use client";

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  normalizeAiEndpointBaseUrl,
  type AiEndpointCandidate,
  type AiEndpointDiscoveryEvent,
  type EnvironmentId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useContext, useEffect, useState } from "react";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { normalizedConfiguredUrls } from "./AiEndpointSettings.logic";

interface AiEndpointDiscoveryProps {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instances: Readonly<Record<string, ProviderInstanceConfig>>;
  readonly active?: boolean;
  readonly readOnly?: boolean;
  readonly onAdopt: (endpoint: AiEndpointCandidate) => void;
}

export function AiEndpointDiscovery({
  environmentId,
  environmentLabel,
  instances,
  active = true,
  readOnly = false,
  onAdopt,
}: AiEndpointDiscoveryProps) {
  const translate = useInterfaceTranslator().message;
  const registry = useContext(RegistryContext);
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const result = useAtomValue(serverEnvironment.aiEndpointDiscovery(environmentId));
  const currentSnapshot = Option.getOrNull(AsyncResult.value(result));
  const supported = config?.environment.capabilities.aiEndpointDiscovery === true;
  const [cancelledScan, setCancelledScan] = useState<{
    environmentId: EnvironmentId;
    snapshot: AiEndpointDiscoveryEvent | null;
  } | null>(null);
  const cancelled = cancelledScan?.environmentId === environmentId;
  const snapshot = cancelled ? cancelledScan.snapshot : currentSnapshot;
  const scanning = !cancelled && (snapshot?.status === "scanning" || result.waiting);
  const configuredUrls = normalizedConfiguredUrls(instances);

  useEffect(() => {
    if (!active || readOnly || !supported) return;
    setCancelledScan(null);
    serverEnvironment.startAiEndpointDiscovery(registry, { environmentId, input: {} });
    return () => serverEnvironment.cancelAiEndpointDiscovery(registry, environmentId);
  }, [active, environmentId, readOnly, registry, supported]);

  if (!active) return null;

  return (
    <section className="grid gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {translate("settings.providers.endpoint.discoveryTitle")}
        </h3>
        {supported && !readOnly ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              if (scanning) {
                serverEnvironment.cancelAiEndpointDiscovery(registry, environmentId);
                setCancelledScan({ environmentId, snapshot });
              } else {
                setCancelledScan(null);
                serverEnvironment.startAiEndpointDiscovery(registry, {
                  environmentId,
                  input: { refresh: true },
                });
              }
            }}
          >
            {translate(
              scanning ? "settings.common.cancel" : "settings.providers.endpoint.discoveryRescan",
            )}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {translate("settings.providers.endpoint.discoveryEnvironment", {
          environment: environmentLabel,
        })}
      </p>
      {readOnly || !supported ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            readOnly
              ? "settings.providers.endpoint.discoveryReadOnly"
              : "settings.providers.endpoint.discoveryUnsupported",
          )}
        </p>
      ) : (
        <>
          <div role="status" className="grid gap-2 text-xs text-muted-foreground">
            {cancelled
              ? translate("settings.providers.endpoint.discoveryCancelled")
              : AsyncResult.isFailure(result)
                ? translate("settings.providers.endpoint.discoveryFailed")
                : scanning
                  ? translate("settings.providers.endpoint.discoveryScanning", {
                      scanned: snapshot?.scanned ?? 0,
                      total: snapshot?.total ?? 0,
                    })
                  : snapshot?.endpoints.length === 0
                    ? translate("settings.providers.endpoint.discoveryEmpty")
                    : null}
            {snapshot?.message ? <p>{snapshot.message}</p> : null}
            {snapshot?.limited ? (
              <p>{translate("settings.providers.endpoint.discoveryLimited")}</p>
            ) : null}
          </div>
          {snapshot?.endpoints.map((endpoint) => (
            <div
              key={endpoint.baseUrl}
              className="flex flex-wrap items-start justify-between gap-2 border-t border-border/50 pt-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <code className="block break-all text-xs">{endpoint.baseUrl}</code>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{endpoint.kind === "lmstudio" ? "LM Studio" : "OpenAI Compatible"}</span>
                  {configuredUrls.has(normalizeAiEndpointBaseUrl(endpoint.baseUrl)) ? (
                    <Badge size="sm" variant="secondary">
                      {translate("settings.providers.endpoint.discoveryExisting")}
                    </Badge>
                  ) : null}
                  {endpoint.requiresApiKey ? (
                    <Badge size="sm" variant="warning">
                      {translate("settings.providers.endpoint.discoveryRequiresKey")}
                    </Badge>
                  ) : null}
                  {!endpoint.verified ? (
                    <Badge size="sm" variant="outline">
                      {translate("settings.providers.endpoint.discoveryUnverified")}
                    </Badge>
                  ) : null}
                </div>
                {endpoint.models.length > 0 ? (
                  <p className="break-words text-xs text-muted-foreground">
                    {endpoint.models
                      .slice(0, 3)
                      .map((model) => model.name || model.id)
                      .join(", ")}
                    {endpoint.models.length > 3
                      ? ` · ${translate("settings.providers.endpoint.discoveryModels", { count: endpoint.models.length })}`
                      : null}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-label={`${translate("settings.providers.endpoint.discoveryUse")} ${endpoint.baseUrl}`}
                onClick={() => onAdopt(endpoint)}
              >
                {translate("settings.providers.endpoint.discoveryUse")}
              </Button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
