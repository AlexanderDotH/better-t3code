import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import { prepareComposerServerUpdateCopy } from "./ComposerServerUpdateStatus";

const downloading = {
  status: "running",
  stage: "downloading",
  fromVersion: "1.0.0",
  targetVersion: "1.1.0",
} as const satisfies Exclude<ServerUpdateState, { status: "idle" }>;

describe("ComposerServerUpdateStatus", () => {
  it("localizes application copy while preserving the server label", () => {
    const serverLabel = "prod-eu-1 / 東京";

    expect(
      prepareComposerServerUpdateCopy({
        state: downloading,
        serverLabel,
        translate: createInterfaceTranslator({ language: "de", locale: "de-DE" }).message,
      }),
    ).toEqual({
      title: "prod-eu-1 / 東京 wird aktualisiert",
      detail: "Wird heruntergeladen…",
    });
    expect(
      prepareComposerServerUpdateCopy({
        state: downloading,
        serverLabel,
        translate: createInterfaceTranslator({ language: "fr", locale: "fr-FR" }).message,
      }),
    ).toEqual({
      title: "Mise à jour de prod-eu-1 / 東京",
      detail: "Téléchargement…",
    });
  });

  it("keeps server-provided failures byte-for-byte unchanged", () => {
    const message = "HTTP 503: überlastet / 再試行";
    const copy = prepareComposerServerUpdateCopy({
      state: {
        status: "failed",
        stage: "downloading",
        fromVersion: "1.0.0",
        targetVersion: "1.1.0",
        message,
      },
      serverLabel: "edge-1",
      translate: createInterfaceTranslator({ language: "de", locale: "de-DE" }).message,
    });

    expect(copy.title).toBe("edge-1 konnte nicht aktualisiert werden");
    expect(copy.detail).toBe(message);
  });
});
