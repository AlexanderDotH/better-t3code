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
import * as DesktopCredentialMigration from "../app/DesktopCredentialMigration.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopWindow from "./DesktopWindow.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import { setDesktopInterfaceLanguage } from "../settings/DesktopInterfaceLanguage.ts";

export class DesktopApplicationMenuActionError extends Schema.TaggedError<DesktopApplicationMenuActionError>()(
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
  | ElectronDialog.ElectronDialog
  | DesktopCredentialMigration.DesktopCredentialMigration;

const { logInfo: logUpdaterInfo } = makeComponentLogger("desktop-updater");

const { logError: logMenuError } = makeComponentLogger("desktop-menu");

const dispatchMenuAction = Effect.fn("desktop.menu.dispatchMenuAction")(function* (
  action: string,
): Effect.fn.Return<void, DesktopWindow.DesktopWindowError, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.dispatchMenuAction(action, {
    reveal: action !== "paste-as-text",
  });
});

const zoomMainWindow = Effect.fn("desktop.menu.zoomMainWindow")(function* (
  direction: DesktopWindow.MainWindowZoomDirection,
): Effect.fn.Return<void, never, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.zoomMain(direction);
});

const runMainContentsCommand = Effect.fn("desktop.menu.runMainContentsCommand")(function* (
  command: DesktopWindow.MainWindowContentsCommand,
): Effect.fn.Return<void, never, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.runMainContentsCommand(command);
});

const checkForUpdatesFromMenu = Effect.fn("desktop.menu.checkForUpdates")(function* (
  language: ResolvedInterfaceLanguage,
) {
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
});

const handleCheckForUpdatesMenuClick = Effect.fn("desktop.menu.handleCheckForUpdatesClick")(
  function* (language: ResolvedInterfaceLanguage) {
    const updates = yield* DesktopUpdates.DesktopUpdates;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const disabledReason = yield* updates.disabledReason;
    const disabledMessageId = Option.isSome(disabledReason)
      ? DesktopUpdates.updateDisabledReasonMessageId(disabledReason.value)
      : undefined;
    if (Option.isSome(disabledReason)) {
      yield* logUpdaterInfo("manual update check requested, but updates are disabled", {
        disabledReason: disabledReason.value,
      });
      yield* electronDialog.showMessageBox({
        type: "info",
        title: translateInterfaceMessage(language, "desktop.update.unavailableTitle"),
        message: translateInterfaceMessage(language, "desktop.update.unavailableMessage"),
        detail:
          disabledMessageId === undefined
            ? disabledReason.value
            : translateInterfaceMessage(language, disabledMessageId),
        buttons: [translateInterfaceMessage(language, "common.ok")],
      });
      return;
    }

    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.activate;
    yield* checkForUpdatesFromMenu(language);
  },
);

/** @public */
export const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const migration = yield* DesktopCredentialMigration.DesktopCredentialMigration;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
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
    const storedSettings = yield* clientSettings.get.pipe(
      Effect.orElseSucceed(() => Option.none()),
    );
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
    const t = (
      key: Parameters<typeof translateInterfaceMessage>[1],
      values?: Parameters<typeof translateInterfaceMessage>[2],
    ) => translateInterfaceMessage(language, key, values);
    const checkForUpdatesClick = () => {
      runMenuEffect("check-for-updates", handleCheckForUpdatesMenuClick(language));
    };
    const settingsClick = () => {
      runMenuEffect("open-settings", dispatchMenuAction("open-settings"));
    };
    // Chromium and the renderer already handle this chord; injecting another paste duplicates text.
    const pasteAsTextClick = (
      _item: Electron.MenuItem,
      _window: Electron.BaseWindow | undefined,
      event: Electron.KeyboardEvent,
    ) => {
      if (event.triggeredByAccelerator === true) return;
      runMenuEffect("paste-as-text", dispatchMenuAction("paste-as-text"));
    };
    const zoomClick = (direction: DesktopWindow.MainWindowZoomDirection) => () => {
      runMenuEffect(`zoom-${direction}`, zoomMainWindow(direction));
    };
    const mainContentsClick = (command: DesktopWindow.MainWindowContentsCommand) => () => {
      runMenuEffect(command, runMainContentsCommand(command));
    };
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (environment.platform === "darwin") {
      const hasOlderCredentials = yield* migration.pending.pipe(
        Effect.tapError((error) => logMenuError("Could not inspect older credentials", { error })),
        Effect.orElseSucceed(() => true),
      );
      template.push({
        label: environment.displayName,
        submenu: [
          { role: "about", label: t("desktop.menu.aboutApp", { app: environment.displayName }) },
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
          ...(hasOlderCredentials
            ? [
                {
                  label: t("desktop.menu.importCredentials"),
                  click: (item: Electron.MenuItem) => {
                    runMenuEffect(
                      "import-credentials",
                      migration.run.pipe(
                        Effect.matchEffect({
                          onFailure: () =>
                            ElectronDialog.ElectronDialog.pipe(
                              Effect.flatMap((dialog) =>
                                dialog.showMessageBox({
                                  type: "warning",
                                  title: t("desktop.credentials.title"),
                                  message: t("desktop.credentials.failed"),
                                  buttons: [t("common.ok")],
                                }),
                              ),
                              Effect.asVoid,
                            ),
                          onSuccess: Effect.fn("desktop.menu.importCredentialsSuccess")(
                            function* () {
                              const dialog = yield* ElectronDialog.ElectronDialog;
                              yield* dialog.showMessageBox({
                                type: "info",
                                title: t("desktop.credentials.title"),
                                message: t("desktop.credentials.imported"),
                                buttons: [t("common.ok")],
                              });
                              item.enabled = false;
                            },
                          ),
                        }),
                      ),
                    );
                  },
                },
              ]
            : []),
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide", label: t("desktop.menu.hideApp", { app: environment.displayName }) },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit", label: t("desktop.menu.quitApp", { app: environment.displayName }) },
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
          // Cmd/Ctrl+W belongs to the renderer's tab close; it must never close the window.
          environment.platform === "darwin"
            ? { label: t("desktop.menu.closeWindow"), click: (_item, window) => window?.close() }
            : { role: "quit" },
        ],
      },
      {
        label: t("desktop.menu.edit"),
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          {
            label: t("desktop.menu.pasteAsText"),
            accelerator: "CmdOrCtrl+Shift+V",
            click: pasteAsTextClick,
          },
          { role: "delete" },
          { type: "separator" },
          { role: "selectAll" },
          ...(environment.platform === "darwin"
            ? [
                { type: "separator" as const },
                {
                  label: t("desktop.menu.speech"),
                  submenu: [{ role: "startSpeaking" as const }, { role: "stopSpeaking" as const }],
                },
              ]
            : []),
        ],
      },
      {
        label: t("desktop.menu.view"),
        submenu: [
          /* Native reload/DevTools/zoom roles target focused guests; these commands must target the app. */
          {
            label: t("desktop.menu.reload"),
            accelerator: "CmdOrCtrl+R",
            click: mainContentsClick("reload"),
          },
          {
            label: t("desktop.menu.forceReload"),
            accelerator: "Shift+CmdOrCtrl+R",
            click: mainContentsClick("forceReload"),
          },
          {
            label: t("desktop.menu.toggleDeveloperTools"),
            accelerator: environment.platform === "darwin" ? "Alt+Command+I" : "Ctrl+Shift+I",
            click: mainContentsClick("toggleDevTools"),
          },
          { type: "separator" },
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
          ...(environment.platform === "darwin"
            ? [
                {
                  label: t("desktop.menu.zoomIn"),
                  accelerator: "CmdOrCtrl+Shift+=",
                  visible: false,
                  click: zoomClick("in"),
                },
              ]
            : []),
          { label: t("desktop.menu.zoomOut"), accelerator: "CmdOrCtrl+-", click: zoomClick("out") },
          // Keypad codes do not match number-row accelerators.
          {
            label: t("desktop.menu.actualSize"),
            accelerator: "CmdOrCtrl+num0",
            visible: false,
            click: zoomClick("reset"),
          },
          {
            label: t("desktop.menu.zoomIn"),
            accelerator: "CmdOrCtrl+numadd",
            visible: false,
            click: zoomClick("in"),
          },
          {
            label: t("desktop.menu.zoomOut"),
            accelerator: "CmdOrCtrl+numsub",
            visible: false,
            click: zoomClick("out"),
          },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        // Electron's default Window submenu adds a Ctrl+W close role off macOS.
        role: "windowMenu",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          ...(environment.platform === "darwin"
            ? [{ type: "separator" as const }, { role: "front" as const }]
            : []),
        ],
      },
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
