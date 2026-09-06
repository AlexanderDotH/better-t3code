import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { didInterfaceLocaleSelectionChange, setClientSettings } from "./clientSettings.ts";
import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as DesktopApplicationMenu from "../../window/DesktopApplicationMenu.ts";

it.effect(
  "persists transparency before updating the native window and skips unchanged preferences",
  () =>
    Effect.gen(function* () {
      let settings = DEFAULT_CLIENT_SETTINGS;
      const applied: boolean[] = [];
      const layer = Layer.mergeAll(
        Layer.mock(DesktopClientSettings.DesktopClientSettings)({
          get: Effect.sync(() => Option.some(settings)),
          set: (next) =>
            Effect.sync(() => {
              settings = next;
            }),
        }),
        Layer.mock(DesktopWindow.DesktopWindow)({
          syncAppearance: Effect.sync(() => {
            applied.push(settings.macosWindowTransparency);
          }),
        }),
        Layer.mock(DesktopApplicationMenu.DesktopApplicationMenu)({}),
      );
      yield* Effect.gen(function* () {
        yield* setClientSettings.handler({ ...settings, macosWindowTransparency: true });
        yield* setClientSettings.handler(settings);
        yield* setClientSettings.handler({ ...settings, macosWindowTransparency: false });
      }).pipe(Effect.provide(layer));
      expect(applied).toEqual([true, false]);
    }),
);

const germanLegacy = {
  preference: "de" as const,
  updatedAt: 1,
  updateId: "desktop:de",
};

describe("didInterfaceLocaleSelectionChange", () => {
  it("reconfigures the desktop menu when a versioned French choice leaves the legacy mirror intact", () => {
    const previous = {
      ...DEFAULT_CLIENT_SETTINGS,
      interfaceLanguageLocalRecord: germanLegacy,
    };
    const next = {
      ...previous,
      interfaceLocaleLocalRecordV1: {
        version: 1 as const,
        preference: "fr" as const,
        updatedAt: 2,
        updateId: "desktop-v1:fr",
      },
    };

    expect(didInterfaceLocaleSelectionChange(previous, next)).toBe(true);
    expect(didInterfaceLocaleSelectionChange(next, next)).toBe(false);
  });
});
