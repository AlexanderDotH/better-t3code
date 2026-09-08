import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export interface DesktopMediaPermissionsInput {
  readonly applicationUrl: string;
  readonly platform: NodeJS.Platform;
}

interface DesktopAudioPermissionRequest {
  readonly applicationUrl: string;
  readonly isMainFrame: boolean;
  readonly mediaTypes: ReadonlyArray<"audio" | "video"> | undefined;
  readonly requestingUrl: string | undefined;
}

function isSameDesktopLocation(applicationUrl: string, candidateUrl: string | undefined): boolean {
  if (candidateUrl === undefined) return false;
  try {
    const application = new URL(applicationUrl);
    const candidate = new URL(candidateUrl);
    return (
      application.protocol === candidate.protocol &&
      application.hostname === candidate.hostname &&
      application.port === candidate.port
    );
  } catch {
    return false;
  }
}

export function isDesktopAudioPermissionRequest(input: DesktopAudioPermissionRequest): boolean {
  return (
    input.isMainFrame &&
    input.mediaTypes?.length === 1 &&
    input.mediaTypes[0] === "audio" &&
    isSameDesktopLocation(input.applicationUrl, input.requestingUrl)
  );
}

export class ElectronMediaPermissions extends Context.Service<
  ElectronMediaPermissions,
  {
    readonly configure: (
      input: DesktopMediaPermissionsInput,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/electron/ElectronMediaPermissions") {}

export const make = ElectronMediaPermissions.of({
  configure: (input) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const browserSession = Electron.session.defaultSession;

        browserSession.setPermissionCheckHandler(
          (_webContents, permission, _requestingOrigin, _details) => {
            if (permission !== "media") return true;

            // Returning false makes Chromium continue to the request handler below,
            // where macOS can show its native prompt in response to the user's click.
            return false;
          },
        );
        browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
          // Keep Electron's existing default behavior for unrelated permissions;
          // this handler only narrows and coordinates microphone capture.
          if (permission !== "media") {
            callback(true);
            return;
          }
          const mediaDetails = details as Electron.MediaAccessPermissionRequest;
          const allowed =
            webContents === Electron.BrowserWindow.getFocusedWindow()?.webContents &&
            isDesktopAudioPermissionRequest({
              applicationUrl: input.applicationUrl,
              isMainFrame: mediaDetails.isMainFrame,
              mediaTypes: mediaDetails.mediaTypes,
              requestingUrl: mediaDetails.requestingUrl,
            });

          if (!allowed) {
            callback(false);
            return;
          }
          if (input.platform !== "darwin") {
            callback(true);
            return;
          }

          void Electron.systemPreferences.askForMediaAccess("microphone").then(
            (granted) => callback(granted),
            () => callback(false),
          );
        });
      }),
      () =>
        Effect.sync(() => {
          const browserSession = Electron.session.defaultSession;
          browserSession.setPermissionCheckHandler(null);
          browserSession.setPermissionRequestHandler(null);
        }),
    ).pipe(Effect.asVoid),
});

export const layer = Layer.succeed(ElectronMediaPermissions, make);
