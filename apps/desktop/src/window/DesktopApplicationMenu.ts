import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as Electron from "electron";
import { resolveInterfaceLocaleSyncRecord } from "@t3tools/client-runtime/interface-language-sync";
import { DEFAULT_INTERFACE_LOCALE_PREFERENCE_V1 } from "@t3tools/contracts";
import {
  resolveInterfaceLocale,
  translateInterfaceMessage,
  type ResolvedInterfaceLanguage,
} from "@t3tools/shared/interfaceLanguage";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopWindow from "./DesktopWindow.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import { setDesktopInterfaceLanguage } from "../settings/DesktopInterfaceLanguage.ts";

export class DesktopApplicationMenuActionError extends Schema.TaggedErrorClass<DesktopApplicationMenuActionError>()(
  "DesktopApplicationMenuActionError",
  {
    action: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop menu action "${this.action}" failed.`;
  }
}

export class DesktopApplicationMenu extends Context.Service<
  DesktopApplicationMenu,
  {
    readonly configure: Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopApplicationMenu") {}

type DesktopApplicationMenuRuntimeServices =
  | DesktopUpdates.DesktopUpdates
  | DesktopWindow.DesktopWindow
  | ElectronDialog.ElectronDialog;

const { logInfo: logUpdaterInfo } = makeComponentLogger("desktop-updater");

const { logError: logMenuError } = makeComponentLogger("desktop-menu");

const updateDisabledReasonMessageId = (
  reason: DesktopUpdates.DesktopUpdateDisabledReason,
): Parameters<typeof translateInterfaceMessage>[1] => {
  switch (reason) {
    case "no-update-feed":
      return "desktop.update.disabled.noFeed";
    case "development-build":
      return "desktop.update.disabled.development";
    case "disabled-by-environment":
      return "desktop.update.disabled.environment";
    case "linux-package-required":
      return "desktop.update.disabled.linuxPackage";
  }
};

const dispatchMenuAction = Effect.fn("desktop.menu.dispatchMenuAction")(function* (
  action: string,
): Effect.fn.Return<void, DesktopWindow.DesktopWindowError, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.dispatchMenuAction(action);
});

const zoomMainWindow = Effect.fn("desktop.menu.zoomMainWindow")(function* (
  direction: DesktopWindow.MainWindowZoomDirection,
): Effect.fn.Return<void, never, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.zoomMain(direction);
});

const checkForUpdatesFromMenu = (language: ResolvedInterfaceLanguage) =>
  Effect.gen(function* () {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const result = yield* updates.check("menu");
    const updateState = result.state;

    if (updateState.status === "up-to-date") {
      yield* electronDialog.showMessageBox({
        type: "info",
        title: translateInterfaceMessage(language, "desktop.update.upToDateTitle"),
        message: translateInterfaceMessage(language, "desktop.update.upToDateMessage", {
          version: updateState.currentVersion,
        }),
        buttons: [translateInterfaceMessage(language, "common.ok")],
      });
    } else if (updateState.status === "error") {
      yield* electronDialog.showMessageBox({
        type: "warning",
        title: translateInterfaceMessage(language, "desktop.update.checkFailedTitle"),
        message: translateInterfaceMessage(language, "desktop.update.checkFailedMessage"),
        detail:
          updateState.message ?? translateInterfaceMessage(language, "desktop.update.unknownError"),
        buttons: [translateInterfaceMessage(language, "common.ok")],
      });
    }
  }).pipe(Effect.withSpan("desktop.menu.checkForUpdates"));

const handleCheckForUpdatesMenuClick = (language: ResolvedInterfaceLanguage) =>
  Effect.gen(function* () {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const disabledReason = yield* updates.disabledReason;
    if (Option.isSome(disabledReason)) {
      yield* logUpdaterInfo("manual update check requested, but updates are disabled", {
        disabledReason: disabledReason.value,
      });
      yield* electronDialog.showMessageBox({
        type: "info",
        title: translateInterfaceMessage(language, "desktop.update.unavailableTitle"),
        message: translateInterfaceMessage(language, "desktop.update.unavailableMessage"),
        detail: translateInterfaceMessage(
          language,
          updateDisabledReasonMessageId(disabledReason.value),
        ),
        buttons: [translateInterfaceMessage(language, "common.ok")],
      });
      return;
    }

    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.ensureMain;
    yield* checkForUpdatesFromMenu(language);
  }).pipe(Effect.withSpan("desktop.menu.handleCheckForUpdatesClick"));

export const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const appName = yield* electronApp.name;
  const context = yield* Effect.context<DesktopApplicationMenuRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);

  const runMenuEffect = <E>(
    action: string,
    effect: Effect.Effect<void, E, DesktopApplicationMenuRuntimeServices>,
  ) => {
    void runPromise(
      effect.pipe(
        Effect.annotateLogs({ action }),
        Effect.withSpan("desktop.menu.action"),
        Effect.catchCause((cause) => {
          const error = new DesktopApplicationMenuActionError({ action, cause });
          return logMenuError(error.message, { error });
        }),
      ),
    );
  };

  const configure = Effect.gen(function* () {
    const storedSettings = yield* clientSettings.get;
    const preference = Option.match(storedSettings, {
      onNone: () => DEFAULT_INTERFACE_LOCALE_PREFERENCE_V1,
      onSome: (settings) =>
        resolveInterfaceLocaleSyncRecord({
          localeRecord: settings.interfaceLocaleLocalRecordV1,
          legacyRecord: settings.interfaceLanguageLocalRecord,
        })?.preference ?? DEFAULT_INTERFACE_LOCALE_PREFERENCE_V1,
    });
    const language = resolveInterfaceLocale(preference, [yield* electronApp.systemLocale]).language;
    setDesktopInterfaceLanguage(language);
    const t = (key: Parameters<typeof translateInterfaceMessage>[1]) =>
      translateInterfaceMessage(language, key);
    const checkForUpdatesClick = () => {
      runMenuEffect("check-for-updates", handleCheckForUpdatesMenuClick(language));
    };
    const settingsClick = () => {
      runMenuEffect("open-settings", dispatchMenuAction("open-settings"));
    };
    const zoomClick = (direction: DesktopWindow.MainWindowZoomDirection) => () => {
      runMenuEffect(`zoom-${direction}`, zoomMainWindow(direction));
    };
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (environment.platform === "darwin") {
      template.push({
        label: appName,
        submenu: [
          { role: "about" },
          {
            label: t("desktop.menu.checkForUpdates"),
            click: checkForUpdatesClick,
          },
          { type: "separator" },
          {
            label: t("desktop.menu.settings"),
            accelerator: "CmdOrCtrl+,",
            click: settingsClick,
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      });
    }

    template.push(
      {
        label: t("desktop.menu.file"),
        submenu: [
          ...(environment.platform === "darwin"
            ? []
            : [
                {
                  label: t("desktop.menu.settings"),
                  accelerator: "CmdOrCtrl+,",
                  click: settingsClick,
                },
                { type: "separator" as const },
              ]),
          { role: environment.platform === "darwin" ? "close" : "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: t("desktop.menu.view"),
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          /*
            Not the zoom roles: those act on the focused webContents, so with
            an embedded preview WebContentsView focused they zoom the guest
            page and the app UI appears stuck. These always zoom the main
            window (see DesktopWindow.zoomMain).
          */
          {
            label: t("desktop.menu.actualSize"),
            accelerator: "CmdOrCtrl+0",
            click: zoomClick("reset"),
          },
          { label: t("desktop.menu.zoomIn"), accelerator: "CmdOrCtrl+=", click: zoomClick("in") },
          {
            label: t("desktop.menu.zoomIn"),
            accelerator: "CmdOrCtrl+Plus",
            visible: false,
            click: zoomClick("in"),
          },
          { label: t("desktop.menu.zoomOut"), accelerator: "CmdOrCtrl+-", click: zoomClick("out") },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        label: t("desktop.menu.help"),
        role: "help",
        submenu: [
          {
            label: t("desktop.menu.checkForUpdates"),
            click: checkForUpdatesClick,
          },
        ],
      },
    );

    yield* electronMenu.setApplicationMenu(template);
  }).pipe(Effect.withSpan("desktop.menu.configure"));

  return DesktopApplicationMenu.of({
    configure,
  });
});

export const layer = Layer.effect(DesktopApplicationMenu, make);
