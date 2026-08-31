import "../../index.css";

import {
  DEFAULT_CLIENT_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  getClientSettings,
} from "../../hooks/useSettings";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";
import type { ModelEsque } from "./providerIconUtils";

const CODEX_INSTANCE = ProviderInstanceId.make("codex");
const OPENROUTER_INSTANCE = ProviderInstanceId.make("openrouter");
const CODEX_DRIVER = ProviderDriverKind.make("codex");
const OPENROUTER_DRIVER = ProviderDriverKind.make("openrouter");

function capabilities(input: {
  readonly contextTokens: number;
  readonly free?: boolean;
  readonly reasoning?: boolean;
  readonly tools?: boolean;
  readonly vision?: boolean;
  readonly textOutput?: boolean;
}): ModelCapabilities {
  const tools = input.tools ?? true;
  return {
    contextWindow: {
      defaultTokens: input.contextTokens,
      maxTokens: input.contextTokens,
    },
    inputModalities: input.vision ? ["text", "image"] : ["text"],
    outputModalities: input.textOutput === false ? ["image"] : ["text"],
    pricing: {
      promptUsdPerMillion: input.free ? 0 : 3,
      completionUsdPerMillion: input.free ? 0 : 15,
    },
    toolSupport: {
      tools,
      parallelToolCalls: tools,
      toolChoice: tools,
    },
    ...(input.reasoning
      ? {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Reasoning effort",
              type: "select",
              options: [{ id: "low", label: "Low" }],
            },
          ],
        }
      : {}),
  };
}

const CODEX_MODELS: ReadonlyArray<ModelEsque> = [
  {
    slug: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    capabilities: capabilities({ contextTokens: 200_000 }),
  },
];

const OPENROUTER_MODELS: ReadonlyArray<ModelEsque> = [
  {
    slug: "anthropic/claude-sonnet-test",
    name: "Claude Sonnet Test",
    capabilities: capabilities({ contextTokens: 200_000, reasoning: true, vision: true }),
  },
  {
    slug: "openai/gpt-free-test",
    name: "Free GPT Test",
    capabilities: capabilities({ contextTokens: 128_000, free: true }),
  },
  {
    slug: "deepseek/reasoner-free-test",
    name: "Free Reasoner Test",
    capabilities: capabilities({ contextTokens: 64_000, free: true, reasoning: true }),
  },
  {
    slug: "mistralai/mistral-small-test",
    name: "Mistral Small Test",
    capabilities: capabilities({ contextTokens: 32_000 }),
  },
  {
    slug: "openai/image-generator-test",
    name: "Image Generator Test",
    isSelectable: false,
    unavailableReason: "Image-only output cannot drive T3 Code agent turns.",
    capabilities: capabilities({ contextTokens: 32_000, textOutput: false, tools: false }),
  },
];

function providerEntry(input: {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly models: ReadonlyArray<ModelEsque>;
  readonly status?: ServerProvider["status"];
}): ProviderInstanceEntry {
  const models: ReadonlyArray<ServerProviderModel> = input.models.map((model) => ({
    ...model,
    isCustom: false,
  }));
  const snapshot: ServerProvider = {
    instanceId: input.instanceId,
    driver: input.driverKind,
    displayName: input.displayName,
    enabled: true,
    installed: true,
    version: "test",
    status: input.status ?? "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-25T00:00:00.000Z",
    models,
    slashCommands: [],
    skills: [],
  };
  return {
    instanceId: input.instanceId,
    driverKind: input.driverKind,
    displayName: input.displayName,
    enabled: true,
    installed: true,
    status: input.status ?? "ready",
    isDefault: true,
    isAvailable: true,
    snapshot,
    models,
  };
}

const INSTANCE_ENTRIES: ReadonlyArray<ProviderInstanceEntry> = [
  providerEntry({
    instanceId: CODEX_INSTANCE,
    driverKind: CODEX_DRIVER,
    displayName: "Codex",
    models: CODEX_MODELS,
  }),
  providerEntry({
    instanceId: OPENROUTER_INSTANCE,
    driverKind: OPENROUTER_DRIVER,
    displayName: "OpenRouter",
    models: OPENROUTER_MODELS,
  }),
];

const MODEL_OPTIONS = new Map([
  [CODEX_INSTANCE, CODEX_MODELS],
  [OPENROUTER_INSTANCE, OPENROUTER_MODELS],
]);

function renderPicker(
  input: {
    readonly onInstanceModelChange?: (instanceId: ProviderInstanceId, model: string) => void;
    readonly onOpenChange?: (open: boolean) => void;
    readonly instanceEntries?: ReadonlyArray<ProviderInstanceEntry>;
  } = {},
) {
  render(
    <main className="min-h-dvh bg-background p-8 text-foreground">
      <ProviderModelPicker
        activeInstanceId={CODEX_INSTANCE}
        model="gpt-5.6-sol"
        lockedProvider={null}
        instanceEntries={input.instanceEntries ?? INSTANCE_ENTRIES}
        modelOptionsByInstance={MODEL_OPTIONS}
        triggerAriaLabel="Choose model"
        onOpenChange={input.onOpenChange}
        onInstanceModelChange={input.onInstanceModelChange ?? (() => {})}
      />
    </main>,
  );
}

async function openPicker() {
  await page.getByRole("button", { name: "Choose model" }).click();
  await expect.element(page.getByPlaceholder("Search models...")).toBeVisible();
}

async function selectProvider(instanceId: ProviderInstanceId | "favorites") {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-model-picker-provider="${instanceId}"] button`,
  );
  expect(button).not.toBeNull();
  button!.click();
}

function catalogPage() {
  return page.getByRole("region", { name: "OpenRouter model catalog" });
}

describe("ProviderModelPicker OpenRouter catalog", () => {
  beforeEach(() => {
    __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, favorites: [] });
  });

  afterEach(() => {
    __resetClientSettingsPersistenceForTests();
  });

  it("opens an authenticated OpenRouter catalog while the default model is not configured", async () => {
    const warningOpenRouter = providerEntry({
      instanceId: OPENROUTER_INSTANCE,
      driverKind: OPENROUTER_DRIVER,
      displayName: "OpenRouter",
      models: OPENROUTER_MODELS,
      status: "warning",
    });
    renderPicker({ instanceEntries: [INSTANCE_ENTRIES[0]!, warningOpenRouter] });
    await openPicker();

    await selectProvider(OPENROUTER_INSTANCE);

    await expect.element(catalogPage()).toBeVisible();
    await expect.element(page.getByText("4 of 5 models", { exact: true })).toBeVisible();
  });

  it("keeps provider-scoped search inside the OpenRouter page without leaking facets elsewhere", async () => {
    renderPicker();
    await openPicker();

    await expect.element(catalogPage()).not.toBeInTheDocument();
    await selectProvider(OPENROUTER_INSTANCE);
    await expect.element(catalogPage()).toBeVisible();
    await expect.element(page.getByText("4 of 5 models", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Free" }).click();
    await expect.element(page.getByText("2 of 5 models", { exact: true })).toBeVisible();

    const search = page.getByPlaceholder("Search OpenRouter models...");
    await search.fill("anthropic/claude-sonnet");
    await expect.element(catalogPage()).toBeVisible();
    await expect.element(page.getByText("0 of 5 models", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Claude Sonnet Test", { exact: true }))
      .not.toBeInTheDocument();

    await page.getByRole("button", { name: "Reset filters" }).click();
    await expect.element(page.getByText("1 of 5 models", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Claude Sonnet Test", { exact: true })).toBeVisible();

    await search.fill("");
    await expect.element(catalogPage()).toBeVisible();
    await page.getByRole("button", { name: "Free" }).click();
    await selectProvider(CODEX_INSTANCE);
    await expect.element(catalogPage()).not.toBeInTheDocument();
    await expect.element(page.getByText("GPT-5.6 Sol", { exact: true })).toBeVisible();

    const globalSearch = page.getByPlaceholder("Search models...");
    await globalSearch.fill("anthropic/claude-sonnet");
    await expect.element(catalogPage()).not.toBeInTheDocument();
    await expect.element(page.getByText("Claude Sonnet Test", { exact: true })).toBeVisible();

    await globalSearch.fill("");
    await selectProvider("favorites");
    await expect.element(catalogPage()).not.toBeInTheDocument();
  });

  it("applies compound filters from the keyboard, updates counts, and resets to agent-ready", async () => {
    renderPicker();
    await openPicker();
    await selectProvider(OPENROUTER_INSTANCE);

    await expect.element(page.getByRole("group", { name: "Catalog filters" })).toBeVisible();
    const contextFilter = page.getByRole("button", { name: "128K+" });
    contextFilter.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2 of 5 models", { exact: true })).toBeVisible();

    const reset = page.getByRole("button", { name: "Reset filters" });
    await reset.click();
    await expect.element(page.getByText("4 of 5 models", { exact: true })).toBeVisible();

    const creators = page.getByRole("button", { name: "Creators" });
    await creators.click();
    const anthropicCreator = page.getByRole("menuitemcheckbox", { name: /Anthropic/ });
    await anthropicCreator.click();
    expect(document.activeElement).toBe(anthropicCreator.element());
    await expect.element(page.getByText("1 of 5 models", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Claude Sonnet Test", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(creators.element());
    await reset.click();
    await expect.element(page.getByText("4 of 5 models", { exact: true })).toBeVisible();

    const freeFilter = page.getByRole("button", { name: "Free" });
    freeFilter.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2 of 5 models", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Free GPT Test", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Free Reasoner Test", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Claude Sonnet Test", { exact: true }))
      .not.toBeInTheDocument();

    const reasoningFilter = page.getByRole("button", { name: "Reasoning" });
    reasoningFilter.element().focus();
    await userEvent.keyboard(" ");
    await expect.element(page.getByText("1 of 5 models", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Free Reasoner Test", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Free GPT Test", { exact: true })).not.toBeInTheDocument();

    reset.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("4 of 5 models", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Claude Sonnet Test", { exact: true })).toBeVisible();
    await expect.element(reset).toBeDisabled();
  });

  it("favorites selectable and incompatible models without selecting them and surfaces both by instance", async () => {
    const onInstanceModelChange = vi.fn();
    const onOpenChange = vi.fn();
    renderPicker({ onInstanceModelChange, onOpenChange });
    await openPicker();
    await selectProvider(OPENROUTER_INSTANCE);

    await page.getByRole("button", { name: "Agent ready" }).click();
    await expect.element(page.getByText("5 of 5 models", { exact: true })).toBeVisible();

    const incompatibleRow = page.getByRole("option", { name: /Image Generator Test/ });
    await expect.element(incompatibleRow).toHaveAttribute("aria-disabled", "true");
    await incompatibleRow.hover();
    await expect
      .element(page.getByText("Image-only output cannot drive T3 Code agent turns."))
      .toBeVisible();
    await incompatibleRow
      .getByRole("button", { name: "Add Image Generator Test to favorites" })
      .click();
    await expect
      .element(
        incompatibleRow.getByRole("button", {
          name: "Remove Image Generator Test from favorites",
        }),
      )
      .toBeVisible();

    const selectableRow = page.getByRole("option", { name: /Free GPT Test/ });
    await selectableRow.getByRole("button", { name: "Add Free GPT Test to favorites" }).click();
    await expect
      .element(selectableRow.getByRole("button", { name: "Remove Free GPT Test from favorites" }))
      .toBeVisible();
    expect(onInstanceModelChange).not.toHaveBeenCalled();
    await expect.element(catalogPage()).toBeVisible();
    expect(getClientSettings().favorites).toEqual([
      { provider: OPENROUTER_INSTANCE, model: "openai/image-generator-test" },
      { provider: OPENROUTER_INSTANCE, model: "openai/gpt-free-test" },
    ]);

    incompatibleRow.element().click();
    expect(onInstanceModelChange).not.toHaveBeenCalled();
    await expect.element(catalogPage()).toBeVisible();

    await selectProvider("favorites");
    await expect.element(catalogPage()).not.toBeInTheDocument();
    await expect.element(page.getByText("Image Generator Test", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Free GPT Test", { exact: true })).toBeVisible();

    await selectProvider(OPENROUTER_INSTANCE);
    await page.getByRole("option", { name: /Free GPT Test/ }).click();
    expect(onInstanceModelChange).toHaveBeenCalledOnce();
    expect(onInstanceModelChange).toHaveBeenCalledWith(OPENROUTER_INSTANCE, "openai/gpt-free-test");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await expect.element(catalogPage()).not.toBeInTheDocument();
  });

  it("cannot press Enter to select a highlighted model hidden by a filter change", async () => {
    const onInstanceModelChange = vi.fn();
    renderPicker({ onInstanceModelChange });
    await openPicker();
    await selectProvider(OPENROUTER_INSTANCE);

    const highlightedModel = page.getByRole("option", { name: /Claude Sonnet Test/ });
    await highlightedModel.hover();
    await expect.element(highlightedModel).toHaveAttribute("data-highlighted");

    await page.getByRole("button", { name: "Free" }).click();
    await expect.element(highlightedModel).not.toBeInTheDocument();
    page.getByPlaceholder("Search OpenRouter models...").element().focus();
    await userEvent.keyboard("{Enter}");

    expect(onInstanceModelChange).not.toHaveBeenCalled();
    await expect.element(catalogPage()).toBeVisible();
  });
});
