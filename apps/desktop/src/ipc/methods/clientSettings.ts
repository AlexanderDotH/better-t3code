import { resolveInterfaceLocaleSyncRecord } from "@t3tools/client-runtime/interface-language-sync";
import { ClientSettingsSchema, type ClientSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopClientSettings from "../../settings/DesktopClientSettings.ts";
import * as DesktopApplicationMenu from "../../window/DesktopApplicationMenu.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export function didInterfaceLocaleSelectionChange(
  previousSettings: ClientSettings | null,
  nextSettings: ClientSettings,
): boolean {
  const previous = previousSettings
    ? resolveInterfaceLocaleSyncRecord({
        localeRecord: previousSettings.interfaceLocaleLocalRecordV1,
        legacyRecord: previousSettings.interfaceLanguageLocalRecord,
      })
    : null;
  const next = resolveInterfaceLocaleSyncRecord({
    localeRecord: nextSettings.interfaceLocaleLocalRecordV1,
    legacyRecord: nextSettings.interfaceLanguageLocalRecord,
  });
  return !(
    previous === next ||
    (previous !== null &&
      next !== null &&
      previous.preference === next.preference &&
      previous.updatedAt === next.updatedAt &&
      previous.updateId === next.updateId)
  );
}

export const getClientSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_CLIENT_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(ClientSettingsSchema),
  handler: Effect.fn("desktop.ipc.clientSettings.get")(function* () {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    return Option.getOrNull(yield* clientSettings.get);
  }),
});

export const setClientSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_CLIENT_SETTINGS_CHANNEL,
  payload: ClientSettingsSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.clientSettings.set")(function* (settings) {
    const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
    const previousSettings = Option.getOrNull(yield* clientSettings.get);
    yield* clientSettings.set(settings);
    if (!didInterfaceLocaleSelectionChange(previousSettings, settings)) return;
    const applicationMenu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
    yield* applicationMenu.configure;
  }),
});
