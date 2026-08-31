import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import { serverUpdateFailureMessage } from "./ServerUpdateAction";
import { pairingErrorMessage } from "./auth/PairingRouteSurface";
import { sshPasswordPromptErrorMessage } from "./desktop/SshPasswordPromptDialog";

const german = createInterfaceTranslator({ language: "de", locale: "de-DE" });

describe("cloud localization fallback policy", () => {
  it("preserves server and transport errors verbatim", () => {
    expect(
      serverUpdateFailureMessage(
        new Error("upstream signature mismatch"),
        german.message("serverUpdate.failureFallback"),
      ),
    ).toBe("upstream signature mismatch");
    expect(
      pairingErrorMessage(
        "backend rejected token 431",
        german.message("pairing.authenticationFailed"),
      ),
    ).toBe("backend rejected token 431");
    expect(
      sshPasswordPromptErrorMessage(
        new Error("Permission denied for deploy@example.test"),
        german.message("sshPassword.failureFallback"),
        german.message("sshPassword.expired"),
      ),
    ).toBe("Permission denied for deploy@example.test");
  });

  it("uses localized typed fallbacks only when external data is absent or classified", () => {
    expect(
      serverUpdateFailureMessage(
        { code: "unknown" },
        german.message("serverUpdate.failureFallback"),
      ),
    ).toBe("Das Server-Update ist fehlgeschlagen.");
    expect(pairingErrorMessage({}, german.message("pairing.authenticationFailed"))).toBe(
      "Authentifizierung fehlgeschlagen.",
    );
    expect(
      sshPasswordPromptErrorMessage(
        new Error("request expired"),
        german.message("sshPassword.failureFallback"),
        german.message("sshPassword.expired"),
      ),
    ).toBe("Diese SSH-Passwortabfrage ist abgelaufen. Stelle die Verbindung erneut her.");
  });
});
