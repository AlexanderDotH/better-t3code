import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "@effect/vitest";
import { afterEach, beforeEach, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  platform: "ios",
  language: "en" as "en" | "de" | "fr",
  locale: "en-US",
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return fixture.platform;
    },
  },
  Pressable: "pressable",
  View: "view",
}));
vi.mock("react-native-svg", () => ({ default: "svg", Circle: "circle", Text: "svg-text" }));
vi.mock("uniwind", () => ({ withUniwind: (component: unknown) => component }));
vi.mock("../../components/AppText", () => ({ AppText: "text" }));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: "symbol" }));
vi.mock("../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () =>
    createInterfaceTranslator({ language: fixture.language, locale: fixture.locale }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("../../lib/runtime", async () => {
  const Layer = await import("effect/Layer");
  return { runtime: { runPromise: vi.fn() }, runtimeContextLayer: Layer.empty };
});

import { MobileDatabase, type StoredPreferencesJson } from "../../persistence/mobile-database";
import { MobileSecureStorage } from "../../persistence/mobile-secure-storage";
import { make, MobilePreferencesStore } from "../../persistence/mobile-preferences";
import { createMobilePreferencesState } from "../../state/preferences";
import { ContextWindowMeterSettingsPreview } from "./ContextWindowMeterSettingsPreview";

type NativeProps = {
  children?: ReactNode;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: { checked?: boolean; disabled?: boolean };
  onPress?: () => void;
};

function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement<NativeProps>(node)) return node;
  if (typeof node.type === "function") {
    return expand((node.type as (props: NativeProps) => ReactNode)(node.props));
  }
  return cloneElement(node, {}, expand(node.props.children));
}

function hosts(node: ReactNode, type: string): ReactElement<NativeProps>[] {
  if (Array.isArray(node)) return node.flatMap((child) => hosts(child, type));
  if (!isValidElement<NativeProps>(node)) return [];
  return [...(node.type === type ? [node] : []), ...hosts(node.props.children, type)];
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  return isValidElement<NativeProps>(node) ? textContent(node.props.children) : "";
}

function radio(tree: ReactNode, enabled: boolean) {
  const translator = createInterfaceTranslator({
    language: fixture.language,
    locale: fixture.locale,
  });
  const label = translator.message(
    enabled ? "settings.contextMeter.preview.on" : "settings.contextMeter.preview.off",
  );
  const choice = hosts(tree, "pressable").find(
    (node) => node.props.accessibilityRole === "radio" && node.props.accessibilityLabel === label,
  );
  if (!choice?.props.onPress) throw new Error("Expected a selectable context meter card");
  return choice;
}

function memoryStorage() {
  let stored: Option.Option<StoredPreferencesJson> = Option.none();
  const writes: StoredPreferencesJson[] = [];
  const secureValues = new Map<string, string>();
  const database = MobileDatabase.of({
    loadCache: () => Effect.succeed(Option.none()),
    listCache: () => Effect.succeed([]),
    loadEnvironmentCacheUpdatedAt: () => Effect.succeed(Option.none()),
    saveCache: () => Effect.void,
    removeCache: () => Effect.void,
    clearCacheKind: () => Effect.void,
    clearEnvironmentCache: () => Effect.void,
    clearAllCaches: Effect.void,
    inspectCaches: Effect.succeed([]),
    loadPreferencesJson: Effect.sync(() => stored),
    savePreferencesJson: (payload, updatedAt) =>
      Effect.sync(() => {
        stored = Option.some({ payload, updatedAt });
        writes.push({ payload, updatedAt });
      }),
  });
  const secureStorage = MobileSecureStorage.of({
    getItem: (key) => Effect.succeed(secureValues.get(key) ?? null),
    setItem: (key, value) =>
      Effect.sync(() => {
        secureValues.set(key, value);
      }),
    removeItem: (key) =>
      Effect.sync(() => {
        secureValues.delete(key);
      }),
  });
  return { database, secureStorage, writes };
}

const registries: AtomRegistry.AtomRegistry[] = [];

const launch = Effect.fnUntraced(function* (storage: ReturnType<typeof memoryStorage>) {
  const store = yield* make().pipe(
    Effect.provideService(MobileDatabase, storage.database),
    Effect.provideService(MobileSecureStorage, storage.secureStorage),
  );
  const state = createMobilePreferencesState(
    Atom.runtime(Layer.succeed(MobilePreferencesStore, store)),
  );
  const registry = AtomRegistry.make();
  registries.push(registry);
  registry.mount(state.preferencesAtom);
  registry.mount(state.updatePreferencesAtom);
  yield* AtomRegistry.getResult(registry, state.preferencesAtom, { suspendOnWaiting: true });
  return {
    render(disabled = false) {
      const result = registry.get(state.preferencesAtom);
      if (!AsyncResult.isSuccess(result)) throw new Error("Expected loaded preferences");
      return expand(
        ContextWindowMeterSettingsPreview({
          enabled: result.value.contextWindowMeterEnabled ?? true,
          disabled,
          onValueChange: (contextWindowMeterEnabled) =>
            registry.set(state.updatePreferencesAtom, { contextWindowMeterEnabled }),
        }),
      );
    },
    flush: AtomRegistry.getResult(registry, state.updatePreferencesAtom, {
      suspendOnWaiting: true,
    }),
    store,
    registry,
  };
});

beforeEach(() => {
  fixture.platform = "ios";
  fixture.language = "en";
  fixture.locale = "en-US";
});

afterEach(() => {
  for (const registry of registries.splice(0)) registry.dispose();
});

describe("mobile context meter preview choices", () => {
  for (const platform of ["ios", "android"]) {
    it.effect(
      `updates the ${platform} choice immediately and retains both directions after app reload`,
      () =>
        Effect.gen(function* () {
          fixture.platform = platform;
          const storage = memoryStorage();
          const first = yield* launch(storage);
          expect(radio(first.render(), true).props.accessibilityState?.checked).toBe(true);

          radio(first.render(), false).props.onPress!();
          expect(radio(first.render(), false).props.accessibilityState?.checked).toBe(true);
          yield* first.flush;
          yield* first.store.savePatch({ baseFontSize: 20 });
          first.registry.dispose();

          const second = yield* launch(storage);
          expect(radio(second.render(), false).props.accessibilityState?.checked).toBe(true);
          expect((yield* second.store.load).baseFontSize).toBe(20);
          radio(second.render(), true).props.onPress!();
          expect(radio(second.render(), true).props.accessibilityState?.checked).toBe(true);
          yield* second.flush;
          second.registry.dispose();

          const third = yield* launch(storage);
          expect(radio(third.render(), true).props.accessibilityState?.checked).toBe(true);
          expect((yield* third.store.load).baseFontSize).toBe(20);
        }),
    );
  }

  it.effect("keeps the selected choice and unavailable cards from writing preferences", () =>
    Effect.gen(function* () {
      const storage = memoryStorage();
      const session = yield* launch(storage);
      const writesBefore = storage.writes.length;
      radio(session.render(), true).props.onPress!();
      radio(session.render(true), false).props.onPress!();
      expect(radio(session.render(true), false).props.accessibilityState?.disabled).toBe(true);
      expect(radio(session.render(), true).props.accessibilityState?.checked).toBe(true);
      expect(storage.writes).toHaveLength(writesBefore);
    }),
  );

  for (const [language, locale] of [
    ["en", "en-US"],
    ["de", "de-DE"],
    ["fr", "fr-FR"],
  ] as const) {
    it.effect(`keeps localized ${language} examples while changing the saved choice`, () =>
      Effect.gen(function* () {
        fixture.language = language;
        fixture.locale = locale;
        const session = yield* launch(memoryStorage());
        const translator = createInterfaceTranslator({ language, locale });
        const example = translator.message("settings.contextMeter.preview.example", {
          used: translator.number(64_000),
          limit: translator.number(128_000),
          percentage: translator.number(0.5, { style: "percent", maximumFractionDigits: 0 }),
        });

        radio(session.render(), false).props.onPress!();
        yield* session.flush;
        const tree = session.render();
        expect(radio(tree, false).props.accessibilityState?.checked).toBe(true);
        for (const enabled of [false, true]) {
          const card = radio(tree, enabled);
          expect(textContent(card)).toContain(example);
          expect(textContent(card)).toContain(
            translator.message("settings.contextMeter.preview.singleLine"),
          );
          expect(textContent(card)).toContain(
            translator.message("settings.contextMeter.preview.expanded"),
          );
          expect(card.props.accessibilityHint).toContain(example);
        }
      }),
    );
  }
});
