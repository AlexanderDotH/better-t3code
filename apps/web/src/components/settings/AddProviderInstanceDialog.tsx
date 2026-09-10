"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { CheckIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  type EnvironmentId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { serverEnvironment } from "../../state/server";
import type { ProviderSettingsModelOption } from "@t3tools/client-runtime/providerSettingsForm";
import { cn } from "../../lib/utils";
import { normalizeProviderAccentColor } from "../../providerInstances";
import { Button } from "../ui/button";
import { ACPRegistryIcon, Gemini, GithubCopilotIcon, PiAgentIcon, type Icon } from "../Icons";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { RadioGroup } from "../ui/radio-group";
import { toastManager } from "../ui/toast";
import { DRIVER_OPTION_BY_VALUE, DRIVER_OPTIONS } from "./providerDriverMeta";
import { ProviderSettingsForm, deriveProviderSettingsFields } from "./ProviderSettingsForm";
import { WizardPanel } from "../ui/wizard";
import {
  ADD_PROVIDER_WIZARD_STEPS,
  resolveWizardNavigation,
  type WizardNavigation,
} from "./AddProviderInstanceDialog.logic";
import { AddProviderInstanceWizardSteps } from "./AddProviderInstanceWizardSteps";
import { AiEndpointDiscovery } from "./AiEndpointDiscovery";
import {
  adoptAiEndpoint,
  aiEndpointBaseUrl,
  aiEndpointBaseUrlError,
  isAiEndpointDriver,
} from "./AiEndpointSettings.logic";
import { ADDITIONAL_BETTER_T3_PROVIDER_DRIVERS } from "./BetterT3SettingsPanel.logic";
import { useSettingsCommand, useSettingsMutation } from "./useSettingsMutation";

const PROVIDER_ACCENT_SWATCHES = [
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
] as const;

/**
 * Normalize a user-provided label into a slug suffix for the instance id.
 * The full id is formed by prefixing the driver slug — e.g. label "Work" on
 * driver "codex" becomes `codex_work`. Output is trimmed to 48 chars so the
 * final composed id stays under the 64-char slug cap enforced by
 * `ProviderInstanceId` in `@t3tools/contracts`.
 */
function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function deriveInstanceId(driver: ProviderDriverKind, label: string): string {
  const slug = slugifyLabel(label);
  return slug ? `${driver}_${slug}` : "";
}

const INSTANCE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
const DEFAULT_DRIVER_OPTION = DRIVER_OPTIONS[0]!;
const FIRST_ADDITIONAL_DRIVER_OPTION = DRIVER_OPTIONS.find((option) =>
  ADDITIONAL_BETTER_T3_PROVIDER_DRIVERS.includes(option.value),
);
const EMPTY_CONFIG_DRAFT: Record<string, unknown> = {};
interface ComingSoonDriverOption {
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly icon: Icon;
}

const COMING_SOON_DRIVER_OPTIONS: readonly ComingSoonDriverOption[] = [
  {
    value: ProviderDriverKind.make("githubCopilot"),
    label: "Github Copilot",
    icon: GithubCopilotIcon,
  },
  {
    value: ProviderDriverKind.make("gemini"),
    label: "Gemini",
    icon: Gemini,
  },
  {
    value: ProviderDriverKind.make("acpRegistry"),
    label: "ACP Registry",
    icon: ACPRegistryIcon,
  },
  {
    value: ProviderDriverKind.make("piAgent"),
    label: "Pi Agent",
    icon: PiAgentIcon,
  },
].filter((option) => !DRIVER_OPTIONS.some((driver) => driver.value === option.value));

/**
 * Validate an instance id against the same slug rules the server applies in
 * `ProviderInstanceId` (see `packages/contracts/src/providerInstance.ts`).
 * Returns a user-facing error string, or `null` if valid.
 */
function validateInstanceId(id: string, existing: ReadonlySet<string>): string | null {
  if (id.length === 0) return "Instance ID is required.";
  if (id.length > 64) return "Instance ID must be 64 characters or fewer.";
  if (!INSTANCE_ID_PATTERN.test(id)) {
    return "Instance ID must start with a letter and use only letters, digits, '-', or '_'.";
  }
  if (existing.has(id)) return `An instance named '${id}' already exists.`;
  return null;
}

interface AddProviderInstanceDialogProps {
  readonly open: boolean;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdded?: (instanceId: ProviderInstanceId) => void;
}

export function AddProviderInstanceDialog({
  open,
  environmentId,
  environmentLabel,
  onOpenChange,
  onAdded,
}: AddProviderInstanceDialogProps) {
  const translate = useInterfaceTranslator().message;
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useSettingsCommand(serverEnvironment.updateSettings);
  const setProviderAuthCredential = useSettingsCommand(serverEnvironment.setProviderAuthCredential);

  const [wizardStep, setWizardStep] = useState(0);
  const [driver, setDriver] = useState<ProviderDriverKind>(DEFAULT_DRIVER_KIND);
  const [label, setLabel] = useState("");
  const [accentColor, setAccentColor] = useState<string>("");
  const [instanceIdOverride, setInstanceIdOverride] = useState<string | null>(null);
  // Driver-specific config drafts keyed by driver so toggling between drivers
  // during the same dialog session does not lose in-progress input.
  const [configByDriver, setConfigByDriver] = useState<Record<string, Record<string, unknown>>>({});
  const [modelsByDriver, setModelsByDriver] = useState<
    Record<
      string,
      {
        baseUrl: string;
        models: ReadonlyArray<ProviderSettingsModelOption>;
      }
    >
  >({});
  const [apiKey, setApiKey] = useState("");
  // Errors are suppressed until the user has tried to submit once. After that
  // they update live so fixing the problem clears the message in place.
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const existingIds = useMemo(
    () => new Set(Object.keys(settings.providerInstances ?? {})),
    [settings.providerInstances],
  );

  const driverOption = DRIVER_OPTION_BY_VALUE[driver] ?? DEFAULT_DRIVER_OPTION;
  const instanceId = instanceIdOverride ?? deriveInstanceId(driver, label);
  const driverSettingsFields = useMemo(
    () => deriveProviderSettingsFields(driverOption),
    [driverOption],
  );
  const instanceIdError = validateInstanceId(instanceId, existingIds);
  const showInstanceIdError = hasAttemptedSubmit && instanceIdError !== null;
  const previewLabel = label.trim() || `${driverOption.label} Workspace`;
  const wizardStepSummaries = [driverOption.label, previewLabel, null] as const;

  const configDraft = configByDriver[driver] ?? EMPTY_CONFIG_DRAFT;
  const endpointDriver = isAiEndpointDriver(driver);
  const endpointBaseUrl = endpointDriver ? aiEndpointBaseUrl(driver, configDraft) : null;
  const discoveredModels = modelsByDriver[driver];
  const configError = endpointDriver ? aiEndpointBaseUrlError(driver, configDraft) : null;
  const setConfigDraft = (config: Record<string, unknown> | undefined) => {
    if (endpointDriver && aiEndpointBaseUrl(driver, config) !== endpointBaseUrl) setApiKey("");
    setConfigByDriver((existing) => {
      const next = { ...existing };
      if (config === undefined || Object.keys(config).length === 0) {
        delete next[driver];
      } else {
        next[driver] = config;
      }
      return next;
    });
  };

  const applyWizardNavigation = (navigation: WizardNavigation) => {
    if (navigation.kind === "blocked") {
      setHasAttemptedSubmit(true);
    }
    setWizardStep(navigation.step);
  };

  const navigateToStep = (requestedStep: number) => {
    applyWizardNavigation(
      resolveWizardNavigation(wizardStep, requestedStep, ADD_PROVIDER_WIZARD_STEPS.length, {
        instanceIdError,
      }),
    );
  };

  const saveInstance = useSettingsMutation({
    mutationFn: async (input: {
      instanceId: ProviderInstanceId;
      instance: ProviderInstanceConfig;
      credential: string;
    }) => {
      await updateSettings({
        environmentId,
        input: {
          patch: {
            providerInstances: {
              ...settings.providerInstances,
              [input.instanceId]: input.instance,
            },
          },
        },
      });
      if (input.credential) {
        try {
          await setProviderAuthCredential({
            environmentId,
            input: { instanceId: input.instanceId, credential: input.credential },
          });
        } catch (error) {
          return error instanceof Error
            ? error.message
            : translate("settings.providers.endpoint.credentialSaveFailed");
        }
      }
      return null;
    },
    onMutate: () => setApiKey(""),
    onSuccess: (credentialError, { instanceId: addedId }) => {
      toastManager.add({
        type: credentialError === null ? "success" : "error",
        title:
          credentialError === null
            ? "Provider instance added"
            : translate("settings.providers.endpoint.credentialSaveFailed"),
        description: credentialError ?? `${driverOption.label} instance '${addedId}' was added.`,
      });
      onAdded?.(addedId);
      onOpenChange(false);
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not add provider instance",
        description: error instanceof Error ? error.message : "Update failed.",
      });
    },
  });

  const handleSave = () => {
    setHasAttemptedSubmit(true);
    if (instanceIdError !== null || configError !== null) return;

    const config = configByDriver[driver] ?? {};
    const hasConfig = Object.keys(config).length > 0;
    const normalizedAccentColor = normalizeProviderAccentColor(accentColor);

    const nextInstance: ProviderInstanceConfig = {
      driver,
      enabled: true,
      ...(label.trim().length > 0 ? { displayName: label.trim() } : {}),
      ...(normalizedAccentColor ? { accentColor: normalizedAccentColor } : {}),
      ...(hasConfig ? { config } : {}),
    };
    // `ProviderInstanceId.make` revalidates the slug; we've already checked
    // it via `validateInstanceId`, but going through the brand constructor
    // keeps the type boundary honest and guards against any future drift in
    // the slug rules.
    const brandedId = ProviderInstanceId.make(instanceId);
    saveInstance.mutate({
      instanceId: brandedId,
      instance: nextInstance,
      credential: endpointDriver ? apiKey.trim() : "",
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saveInstance.isPending) return;
        if (!next) setApiKey("");
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-xl overflow-hidden">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Add provider instance</DialogTitle>
            <DialogDescription>
              Configure an additional provider instance on {environmentLabel} — for example, a
              second Codex install pointed at a different workspace.
            </DialogDescription>
            <AddProviderInstanceWizardSteps
              currentStep={wizardStep}
              summaries={wizardStepSummaries}
              instanceIdError={instanceIdError}
              onNavigation={applyWizardNavigation}
            />
          </DialogHeader>

          <WizardPanel inert={saveInstance.isPending}>
            <div className={cn("grid gap-2", wizardStep !== 0 && "hidden")}>
              <div id="add-instance-driver-label" className="text-sm font-medium text-foreground">
                Driver
              </div>
              <RadioGroup
                value={driver}
                onValueChange={(value) => {
                  setDriver(ProviderDriverKind.make(value));
                  setApiKey("");
                }}
                aria-labelledby="add-instance-driver-label"
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                {DRIVER_OPTIONS.flatMap((option) => {
                  const IconComponent = option.icon;
                  const row = (
                    <RadioPrimitive.Root
                      key={option.value}
                      value={option.value}
                      className="relative flex cursor-pointer items-center gap-3 rounded-lg bg-card px-3 py-3 text-left text-muted-foreground outline-none ring-1 ring-black/5 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary/8 data-checked:text-foreground data-checked:ring-2 data-checked:ring-primary data-checked:hover:bg-primary/8 dark:bg-white/3 dark:ring-white/5 dark:hover:bg-white/5 dark:data-checked:bg-primary/15 dark:data-checked:ring-primary dark:data-checked:hover:bg-primary/15"
                    >
                      <IconComponent className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {option.label}
                      </span>
                      <RadioPrimitive.Indicator
                        className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                        aria-hidden
                      >
                        <CheckIcon className="size-3.5 shrink-0" />
                      </RadioPrimitive.Indicator>
                      {option.badgeMessageKey ? (
                        <Badge variant="warning" size="sm">
                          {translate(option.badgeMessageKey)}
                        </Badge>
                      ) : null}
                    </RadioPrimitive.Root>
                  );
                  return option === FIRST_ADDITIONAL_DRIVER_OPTION
                    ? [
                        <div
                          key="additional-heading"
                          className="pt-2 text-xs font-medium text-muted-foreground sm:col-span-2"
                        >
                          {translate("settings.betterT3.providers.additionalHeading")}
                        </div>,
                        row,
                      ]
                    : [row];
                })}
                {COMING_SOON_DRIVER_OPTIONS.map((option) => {
                  const IconComponent = option.icon;
                  return (
                    <RadioPrimitive.Root
                      key={option.value}
                      value={option.value}
                      disabled
                      className={cn(
                        "relative flex cursor-not-allowed items-center gap-3 rounded-lg bg-card/60 px-3 py-3 text-left opacity-55 outline-none ring-1 ring-black/5 dark:bg-white/2 dark:ring-white/5",
                      )}
                    >
                      <IconComponent
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {option.label}
                      </span>
                      <Badge variant="warning" size="sm">
                        Coming Soon
                      </Badge>
                    </RadioPrimitive.Root>
                  );
                })}
              </RadioGroup>
            </div>

            <label className={cn("grid gap-2", wizardStep !== 1 && "hidden")}>
              <span className="text-xs font-medium text-foreground">Label</span>
              <Input
                className="bg-background"
                placeholder="e.g. Work"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
              <span className="text-[11px] text-muted-foreground">
                Shown in the provider list. Optional.
              </span>
            </label>

            <label className={cn("grid gap-2", wizardStep !== 1 && "hidden")}>
              <span className="text-xs font-medium text-foreground">Instance ID</span>
              <Input
                className="bg-background"
                placeholder={`${driver}_work`}
                value={instanceId}
                onChange={(event) => {
                  setInstanceIdOverride(event.target.value);
                }}
                aria-invalid={showInstanceIdError}
              />
              {showInstanceIdError ? (
                <span className="text-[11px] text-destructive">{instanceIdError}</span>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Routing key used by threads and sessions. Letters, digits, '-', or '_'.
                </span>
              )}
            </label>

            <div className={cn("grid gap-2", wizardStep !== 1 && "hidden")}>
              <span className="text-xs font-medium text-foreground">Accent color</span>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <input
                  type="color"
                  value={normalizeProviderAccentColor(accentColor) ?? PROVIDER_ACCENT_SWATCHES[0]}
                  onChange={(event) => setAccentColor(event.target.value)}
                  aria-label="Provider instance accent color"
                  className="h-8 w-10 cursor-pointer rounded-xl border border-input bg-background p-0.5"
                />
                <div className="flex flex-wrap gap-1.5">
                  {PROVIDER_ACCENT_SWATCHES.map((swatch) => {
                    const selected = accentColor.toLowerCase() === swatch;
                    return (
                      <button
                        key={swatch}
                        type="button"
                        className={cn(
                          "size-6 cursor-pointer rounded-full border transition",
                          selected
                            ? "scale-110 border-foreground ring-2 ring-ring ring-offset-1 ring-offset-background"
                            : "border-black/10 hover:scale-105 dark:border-white/20",
                        )}
                        style={{ backgroundColor: swatch }}
                        onClick={() => setAccentColor(swatch)}
                        aria-label={`Use ${swatch} accent`}
                      />
                    );
                  })}
                </div>
                {accentColor ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => setAccentColor("")}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              <span className="text-[11px] text-muted-foreground">
                Optional marker shown in the picker.
              </span>
            </div>

            {driverSettingsFields.length > 0 ? (
              <div className={cn("grid gap-4", wizardStep !== 2 && "hidden")}>
                <ProviderSettingsForm
                  definition={driverOption}
                  value={configDraft}
                  models={
                    discoveredModels?.baseUrl === endpointBaseUrl
                      ? discoveredModels.models
                      : undefined
                  }
                  idPrefix={`add-provider-${driver}`}
                  variant="dialog"
                  onChange={setConfigDraft}
                />
                {endpointDriver ? (
                  <>
                    {hasAttemptedSubmit && configError ? (
                      <p role="alert" className="text-xs text-destructive">
                        {translate(configError)}
                      </p>
                    ) : null}
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium text-foreground">
                        {translate("settings.providers.endpoint.apiKey")}
                      </span>
                      <Input
                        type="password"
                        autoComplete="off"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.currentTarget.value)}
                        spellCheck={false}
                      />
                      <span className="text-xs text-muted-foreground">
                        {translate("settings.providers.endpoint.apiKeyDescription")}
                      </span>
                    </label>
                    <AiEndpointDiscovery
                      environmentId={environmentId}
                      environmentLabel={environmentLabel}
                      instances={settings.providerInstances ?? {}}
                      active={open && wizardStep === 2}
                      onAdopt={(endpoint) => {
                        const nextDriver = ProviderDriverKind.make(endpoint.kind);
                        setConfigByDriver((existing) => ({
                          ...existing,
                          [nextDriver]: adoptAiEndpoint(
                            existing[nextDriver] ?? configDraft,
                            endpoint,
                          ),
                        }));
                        setModelsByDriver((existing) => ({
                          ...existing,
                          [nextDriver]: {
                            baseUrl: aiEndpointBaseUrl(nextDriver, { baseUrl: endpoint.baseUrl })!,
                            models: endpoint.models.map((model) => ({
                              slug: model.id,
                              name: model.name || model.id,
                            })),
                          },
                        }));
                        setApiKey("");
                        setDriver(nextDriver);
                      }}
                    />
                  </>
                ) : null}
              </div>
            ) : wizardStep === 2 ? (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">
                  This driver has no required configuration. You can add the instance now.
                </p>
              </div>
            ) : null}
          </WizardPanel>

          <DialogFooter variant="bare">
            <Button
              variant="outline"
              disabled={saveInstance.isPending}
              onClick={() => {
                if (wizardStep === 0) {
                  setApiKey("");
                  onOpenChange(false);
                  return;
                }
                setWizardStep((step) => Math.max(0, step - 1));
              }}
            >
              {wizardStep === 0 ? "Cancel" : "Back"}
            </Button>
            {wizardStep < ADD_PROVIDER_WIZARD_STEPS.length - 1 ? (
              <Button onClick={() => navigateToStep(wizardStep + 1)}>Next</Button>
            ) : (
              <Button disabled={saveInstance.isPending} onClick={handleSave}>
                Add instance
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
