import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
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
  Pressable: (props: NativeProps) =>
    createElement(
      "button",
      {
        role: props.accessibilityRole,
        "aria-label": props.accessibilityLabel,
        "aria-description": props.accessibilityHint,
        "aria-checked": props.accessibilityState?.checked,
        disabled: props.accessibilityState?.disabled,
        onClick: props.onPress,
      },
      props.children,
    ),
  View: (props: NativeProps) =>
    createElement(
      "div",
      { role: props.accessibilityRole, "aria-label": props.accessibilityLabel },
      props.children,
    ),
}));
vi.mock("react-native-reanimated", () => {
  const animation = {
    duration: () => animation,
    delay: () => animation,
    reduceMotion: () => animation,
  };
  return {
    default: {
      View: (props: NativeProps) =>
        createElement("div", { "data-animation": true }, props.children),
    },
    FadeInDown: animation,
    ZoomIn: animation,
    ReduceMotion: { System: "system" },
    useReducedMotion: () => false,
  };
});
vi.mock("../../components/ui/AppText", () => ({
  AppText: (props: NativeProps) => createElement("span", {}, props.children),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../threads/ThreadContextMeterRing", () => ({ ThreadContextMeterRing: () => null }));
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
  return { runtime: { runPromise: vi.fn() }, runtimeContextLayer: Layer.empty, layer: Layer.empty };
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

function radio(tree: HTMLElement, enabled: boolean) {
  const translator = createInterfaceTranslator({
    language: fixture.language,
    locale: fixture.locale,
  });
  const label = translator.message(
    enabled ? "settings.contextMeter.preview.on" : "settings.contextMeter.preview.off",
  );
  const choice = Array.from(tree.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
    (node) => node.getAttribute("aria-label") === label,
  );
  if (!choice) throw new Error("Expected a selectable context meter card");
  return choice;
}

function press(choice: HTMLButtonElement) {
  act(() => choice.click());
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
const roots: Root[] = [];

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
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  return {
    render(disabled = false) {
      const result = registry.get(state.preferencesAtom);
      if (!AsyncResult.isSuccess(result)) throw new Error("Expected loaded preferences");
      act(() =>
        root.render(
          <ContextWindowMeterSettingsPreview
            enabled={result.value.contextWindowMeterEnabled ?? true}
            disabled={disabled}
            onValueChange={(contextWindowMeterEnabled) =>
              registry.set(state.updatePreferencesAtom, { contextWindowMeterEnabled })
            }
          />,
        ),
      );
      return container;
    },
    flush: AtomRegistry.getResult(registry, state.updatePreferencesAtom, {
      suspendOnWaiting: true,
    }),
    store,
    registry,
  };
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.platform = "ios";
  fixture.language = "en";
  fixture.locale = "en-US";
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const registry of registries.splice(0)) registry.dispose();
  vi.unstubAllGlobals();
});

describe("mobile context meter preview choices", () => {
  it.effect.each(["ios", "android"])(
    "updates the %s choice immediately and retains both directions after app reload",
    (platform) =>
      Effect.gen(function* () {
        fixture.platform = platform;
        const storage = memoryStorage();
        const first = yield* launch(storage);
        expect(radio(first.render(), true).getAttribute("aria-checked")).toBe("true");

        press(radio(first.render(), false));
        expect(radio(first.render(), false).getAttribute("aria-checked")).toBe("true");
        yield* first.flush;
        yield* first.store.savePatch({ baseFontSize: 20 });
        first.registry.dispose();

        const second = yield* launch(storage);
        expect(radio(second.render(), false).getAttribute("aria-checked")).toBe("true");
        expect((yield* second.store.load).baseFontSize).toBe(20);
        press(radio(second.render(), true));
        expect(radio(second.render(), true).getAttribute("aria-checked")).toBe("true");
        yield* second.flush;
        second.registry.dispose();

        const third = yield* launch(storage);
        expect(radio(third.render(), true).getAttribute("aria-checked")).toBe("true");
        expect((yield* third.store.load).baseFontSize).toBe(20);
      }),
  );

  it.effect(
    "replays the selected choice without writing preferences and ignores unavailable cards",
    () =>
      Effect.gen(function* () {
        const storage = memoryStorage();
        const session = yield* launch(storage);
        const writesBefore = storage.writes.length;
        const choice = radio(session.render(), true);
        const before = choice.querySelector("[data-animation]");
        press(choice);
        expect(choice.querySelector("[data-animation]")).not.toBe(before);
        press(radio(session.render(true), false));
        expect(radio(session.render(true), false).disabled).toBe(true);
        expect(radio(session.render(), true).getAttribute("aria-checked")).toBe("true");
        expect(storage.writes).toHaveLength(writesBefore);
      }),
  );

  it.effect.each([
    { language: "en", locale: "en-US" },
    { language: "de", locale: "de-DE" },
    { language: "fr", locale: "fr-FR" },
  ] as const)(
    "keeps localized $language examples while changing the saved choice",
    ({ language, locale }) =>
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

        press(radio(session.render(), false));
        yield* session.flush;
        const tree = session.render();
        expect(radio(tree, false).getAttribute("aria-checked")).toBe("true");
        for (const enabled of [false, true]) {
          const card = radio(tree, enabled);
          expect(card.textContent).toContain(example);
          expect(card.textContent).toContain(
            translator.message("settings.contextMeter.preview.singleLine"),
          );
          expect(card.textContent).toContain(
            translator.message("settings.contextMeter.preview.expanded"),
          );
          expect(card.getAttribute("aria-description")).toContain(example);
        }
      }),
  );
});
