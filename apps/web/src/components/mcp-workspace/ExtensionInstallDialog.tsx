import type {
  EnvironmentId,
  ExtensionCatalogEntry,
  ProviderInstanceId,
  SkillMutationScope,
} from "@t3tools/contracts";
import { useState } from "react";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { agentSettingsEnvironment } from "~/state/agentSettings";
import { useProjects, useServerConfigs } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useSettingsCommand, useSettingsMutation } from "../settings/useSettingsMutation";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { catalogMcpServer } from "./extensionStore.logic";
import {
  deriveMcpProviderTabs,
  mcpInstallationTargets,
  mcpMutationToastPresentation,
} from "../settings/McpServersSettings.logic";
import { toastManager } from "../ui/toast";

export function ExtensionInstallDialog(props: {
  entry: ExtensionCatalogEntry;
  environmentId: EnvironmentId;
  projectCwd?: string | null | undefined;
  providerInstanceId?: ProviderInstanceId | null | undefined;
  readOnly: boolean;
  installed: boolean;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const t = useInterfaceTranslator().message;
  const projects = useProjects();
  const config = useServerConfigs().get(props.environmentId);
  const project = projects.find(
    (candidate) =>
      candidate.environmentId === props.environmentId &&
      candidate.workspaceRoot === props.projectCwd,
  );
  const [scope, setScope] = useState<SkillMutationScope>(project ? "project" : "global");
  const [connectionIndex, setConnectionIndex] = useState("0");
  const [selectedProviderId, setProviderId] = useState<string>(props.providerInstanceId ?? "all");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const connection = props.entry.connections[Number(connectionIndex)];
  const skill = props.entry.kind === "skill";
  const providerStatus = useEnvironmentQuery(
    !skill
      ? agentSettingsEnvironment.mcp.providerStatusQuery({
          environmentId: props.environmentId,
          input: {},
        })
      : null,
  );
  const providerTabs = deriveMcpProviderTabs(
    (config?.providers ?? []).map((provider) => ({
      ...provider,
      mcpCapability: providerStatus.data?.providers.find(
        (status) => status.instanceId === provider.instanceId,
      )?.capability,
    })),
  );
  const providers = skill
    ? providerTabs.filter((provider) => !provider.disabled)
    : mcpInstallationTargets(providerTabs);
  const providerId = providers.some((provider) => provider.instanceId === selectedProviderId)
    ? selectedProviderId
    : "all";
  const preview = useEnvironmentQuery(
    skill
      ? agentSettingsEnvironment.skills.previewRegistryQuery({
          environmentId: props.environmentId,
          input: { source: props.entry.id },
        })
      : null,
  );
  const installSkill = useSettingsCommand(agentSettingsEnvironment.skills.installRegistry);
  const addServer = useSettingsCommand(agentSettingsEnvironment.mcp.create);
  const install = useSettingsMutation({
    mutationFn: async () => {
      if (props.readOnly) throw new Error(t("settings.mcp.store.readOnly"));
      if (!skill && (providers.length === 0 || providerStatus.isPending || providerStatus.error)) {
        throw new Error(t("settings.mcp.store.noActiveProviders"));
      }
      const projectScope =
        scope === "project" && project
          ? { projectId: project.id, projectCwd: project.workspaceRoot }
          : {};
      if (skill) {
        if (!preview.data) return;
        await installSkill({
          environmentId: props.environmentId,
          input: {
            source: props.entry.id,
            contentHash: preview.data.contentHash,
            scope,
            ...projectScope,
          },
        });
      } else {
        if (!connection) return;
        const server = catalogMcpServer({
          entry: props.entry,
          connection,
          values,
          scope,
          ...projectScope,
          providerRouting: {
            mode: "selected",
            instanceIds:
              providerId === "all"
                ? providers.map((provider) => provider.instanceId as ProviderInstanceId)
                : [providerId as ProviderInstanceId],
          },
        });
        const result = await addServer({ environmentId: props.environmentId, input: { server } });
        toastManager.add(mcpMutationToastPresentation(result, t("settings.mcp.store.installed")));
      }
    },
    onMutate: () => setError(null),
    onSuccess: props.onInstalled,
    onError: (error) => setError(error instanceof Error ? error.message : String(error)),
  });
  const missingRequired = connection?.inputs.some(
    (field) => field.required && !(values[field.key] ?? field.defaultValue).trim(),
  );
  const canInstall =
    !props.readOnly &&
    !props.installed &&
    !install.isPending &&
    (skill
      ? Boolean(preview.data) && !preview.isPending && !preview.error
      : Boolean(connection) &&
        !missingRequired &&
        providers.length > 0 &&
        !providerStatus.isPending &&
        !providerStatus.error);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !install.isPending) props.onClose();
      }}
    >
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.entry.name}</DialogTitle>
          <DialogDescription>{props.entry.description || props.entry.source}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <a
            href={props.entry.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary text-sm underline underline-offset-4"
          >
            {t("settings.mcp.store.source")} · {props.entry.source}
          </a>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("settings.mcp.store.scope")}</Label>
              <Select
                value={scope}
                disabled={install.isPending}
                onValueChange={(value) => setScope(value === "project" ? "project" : "global")}
              >
                <SelectTrigger aria-label={t("settings.mcp.store.scope")}>
                  <SelectValue>
                    {t(
                      scope === "project"
                        ? "settings.mcp.store.project"
                        : "settings.mcp.store.global",
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="global">{t("settings.mcp.store.global")}</SelectItem>
                  {project ? (
                    <SelectItem value="project">
                      {t("settings.mcp.store.project")} · {project.title}
                    </SelectItem>
                  ) : null}
                </SelectPopup>
              </Select>
            </div>
            {skill ? (
              <div className="grid content-start gap-2">
                <Label>{t("settings.mcp.store.activeProviders")}</Label>
                <p className="text-sm">
                  {providers.map((provider) => provider.label).join(", ") ||
                    t("settings.mcp.store.noActiveProviders")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.mcp.store.sharedSkills")}
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label>{t("settings.mcp.store.provider")}</Label>
                <Select
                  value={providerId}
                  disabled={install.isPending || providers.length === 0 || providerStatus.isPending}
                  onValueChange={(value) => setProviderId(value ?? "all")}
                >
                  <SelectTrigger aria-label={t("settings.mcp.store.provider")}>
                    <SelectValue>
                      {providerId === "all"
                        ? t("settings.mcp.store.allProviders")
                        : providers.find((provider) => provider.instanceId === providerId)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="all">{t("settings.mcp.store.allProviders")}</SelectItem>
                    {providers.map((provider) => (
                      <SelectItem key={provider.instanceId} value={provider.instanceId}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {providerStatus.error ? (
                  <p role="alert" className="text-xs text-destructive">
                    {providerStatus.error}
                  </p>
                ) : providers.length === 0 && !providerStatus.isPending ? (
                  <p className="text-xs text-muted-foreground">
                    {t("settings.mcp.store.noActiveProviders")}
                  </p>
                ) : null}
              </div>
            )}
          </div>
          {skill ? (
            <>
              {preview.isPending ? (
                <p role="status" className="text-muted-foreground text-sm">
                  {t("settings.mcp.store.previewLoading")}
                </p>
              ) : null}
              {preview.error ? (
                <div role="alert" className="space-y-2 text-sm text-destructive">
                  <p>{preview.error}</p>
                  <Button variant="outline" size="sm" onClick={preview.refresh}>
                    {t("settings.mcp.store.retry")}
                  </Button>
                </div>
              ) : null}
              {preview.data ? (
                <>
                  <p className="text-sm">{preview.data.description}</p>
                  <p className="text-muted-foreground text-xs">
                    {t("settings.mcp.store.files", { count: preview.data.fileCount })}
                  </p>
                  <pre
                    tabIndex={0}
                    aria-label={t("settings.mcp.store.instructions")}
                    className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-4 text-xs leading-relaxed"
                  >
                    {preview.data.body}
                  </pre>
                </>
              ) : null}
              <p className="text-muted-foreground text-xs">{t("settings.mcp.store.community")}</p>
            </>
          ) : (
            <>
              {props.entry.connections.length > 1 ? (
                <div className="grid gap-2">
                  <Label>{t("settings.mcp.store.connection")}</Label>
                  <Select
                    value={connectionIndex}
                    disabled={install.isPending}
                    onValueChange={(value) => {
                      setConnectionIndex(value ?? "0");
                      setValues({});
                      setError(null);
                    }}
                  >
                    <SelectTrigger aria-label={t("settings.mcp.store.connection")}>
                      <SelectValue>{connection?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {props.entry.connections.map((option, index) => (
                        <SelectItem key={JSON.stringify(option)} value={String(index)}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}
              {connection ? (
                <>
                  <p className="text-muted-foreground text-xs">
                    {t(
                      connection.transport === "stdio"
                        ? "settings.mcp.store.localSetup"
                        : "settings.mcp.store.remoteSetup",
                    )}
                  </p>
                  <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/30 p-3 text-xs">
                    {connection.transport === "stdio"
                      ? [
                          connection.command,
                          ...connection.args.flatMap((arg) => [
                            ...(arg.name ? [arg.name] : []),
                            arg.value,
                          ]),
                        ].join(" ")
                      : connection.url}
                  </pre>
                  {connection.inputs.map((field) => (
                    <label key={field.key} className="grid gap-1.5 text-sm">
                      <span className="flex items-baseline gap-2 font-medium">
                        {field.label}
                        <span className="font-normal text-muted-foreground text-xs">
                          {t(
                            field.required
                              ? "settings.mcp.store.required"
                              : "settings.mcp.store.optional",
                          )}
                        </span>
                      </span>
                      {field.description ? (
                        <span className="text-muted-foreground text-xs">{field.description}</span>
                      ) : null}
                      <Input
                        type={field.secret ? "password" : "text"}
                        autoComplete="off"
                        spellCheck={false}
                        required={field.required}
                        disabled={install.isPending}
                        value={values[field.key] ?? field.defaultValue}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setValues((current) => ({ ...current, [field.key]: value }));
                        }}
                      />
                    </label>
                  ))}
                </>
              ) : (
                <p className="text-muted-foreground text-sm">{t("settings.mcp.store.manual")}</p>
              )}
            </>
          )}
          {props.readOnly ? (
            <p className="text-muted-foreground text-sm">{t("settings.mcp.store.readOnly")}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={install.isPending} onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!canInstall} onClick={() => install.mutate()}>
            {t(
              props.installed
                ? "settings.mcp.store.installed"
                : install.isPending
                  ? "settings.mcp.store.installing"
                  : skill
                    ? "settings.mcp.store.install"
                    : "settings.mcp.store.addServer",
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
