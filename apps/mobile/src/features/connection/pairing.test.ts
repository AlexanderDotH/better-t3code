import { describe, expect, it } from "vite-plus/test";

import {
  buildPairingUrl,
  describePairingDestination,
  extractPairingUrlFromQrPayload,
  pairingFailureMessage,
  pairingStageLabel,
  PairingQrPayloadEmptyError,
  parsePairingUrl,
  resolvePairingRouteIntent,
} from "./pairing";

describe("buildPairingUrl", () => {
  it("uses HTTP for a schemeless IP address", () => {
    expect(buildPairingUrl("192.168.1.100:3773", "pairing-token")).toBe(
      "http://192.168.1.100:3773/#token=pairing-token",
    );
  });

  it("keeps HTTPS as the default for a schemeless hostname", () => {
    expect(buildPairingUrl("remote.example.com", "pairing-token")).toBe(
      "https://remote.example.com/#token=pairing-token",
    );
  });

  it("preserves an explicit scheme for an IP address", () => {
    expect(buildPairingUrl("https://192.168.1.100:3773", "pairing-token")).toBe(
      "https://192.168.1.100:3773/#token=pairing-token",
    );
  });
});

describe("extractPairingUrlFromQrPayload", () => {
  it("trims raw pairing urls from qr payloads", () => {
    expect(
      extractPairingUrlFromQrPayload("  https://remote.example.com/pair#token=pairing-token  "),
    ).toBe("https://remote.example.com/pair#token=pairing-token");
  });

  it("unwraps mobile deep links that carry an encoded pairing url", () => {
    expect(
      extractPairingUrlFromQrPayload(
        "t3code://pair?pairingUrl=https%3A%2F%2Fremote.example.com%2Fpair%23token%3Dpairing-token",
      ),
    ).toBe("https://remote.example.com/pair#token=pairing-token");
  });

  it("rejects empty qr payloads", () => {
    expect(() => extractPairingUrlFromQrPayload("   ")).toThrowError(PairingQrPayloadEmptyError);
    expect(() => extractPairingUrlFromQrPayload("   ")).toThrowError(
      "Scanned QR code did not contain a pairing URL.",
    );
  });
});

describe("parsePairingUrl", () => {
  it("reads hosted pairing links into backend host fields", () => {
    expect(
      parsePairingUrl(
        "https://app.t3.codes/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net%2F#token=pairing-token",
      ),
    ).toEqual({
      host: "https://desktop.tailnet.ts.net",
      code: "pairing-token",
    });
  });
});

describe("describePairingDestination", () => {
  it("returns a token-free HTTPS review for a hostname", () => {
    const review = describePairingDestination(
      "https://remote.example.com/path#token=pairing-secret",
    );

    expect(review).toEqual({
      destination: "https://remote.example.com",
      transport: "HTTPS",
      encrypted: true,
      transportDetail: "Encrypted connection",
    });
    expect(JSON.stringify(review)).not.toContain("pairing-secret");
  });

  it("makes local HTTP transport explicit without exposing its token", () => {
    const review = describePairingDestination(
      buildPairingUrl("192.168.1.100:3773", "local-pairing-secret"),
    );

    expect(review).toEqual({
      destination: "http://192.168.1.100:3773",
      transport: "HTTP",
      encrypted: false,
      transportDetail: "Unencrypted HTTP connection",
    });
    expect(JSON.stringify(review)).not.toContain("local-pairing-secret");
  });

  it("rejects a request without a pairing credential before review", () => {
    expect(() => describePairingDestination("https://remote.example.com")).toThrowError(
      "Enter a pairing code.",
    );
  });
});

describe("resolvePairingRouteIntent", () => {
  it("prefills production links for review but never auto-connects them", () => {
    expect(
      resolvePairingRouteIntent(
        {
          pairingUrl: " https://remote.example.com/#token=pairing-secret ",
          autoConnect: "true",
        },
        false,
      ),
    ).toEqual({
      pairingUrl: "https://remote.example.com/#token=pairing-secret",
      shouldAutoConnect: false,
    });
  });

  it("preserves explicit development auto-connect semantics", () => {
    expect(
      resolvePairingRouteIntent(
        {
          pairingUrl: "https://remote.example.com/#token=pairing-secret",
          autoConnect: "1",
        },
        true,
      ).shouldAutoConnect,
    ).toBe(true);
  });
});

describe("pairing progress presentation", () => {
  it("uses user-facing labels that never include credentials", () => {
    expect(pairingStageLabel("validating")).toBe("Validating details...");
    expect(pairingStageLabel("checking-host")).toBe("Checking host...");
    expect(pairingStageLabel("validating-code")).toBe("Validating pairing code...");
    expect(pairingStageLabel("saving")).toBe("Saving environment...");
  });

  it("turns the failing stage into actionable recovery copy", () => {
    expect(pairingFailureMessage("checking-host", "Network request failed.")).toBe(
      "Could not reach this host. Check that the address is correct and reachable from this device. Network request failed.",
    );
    expect(pairingFailureMessage("validating-code", "The credential is invalid.")).toBe(
      "The host was found, but the pairing code was rejected or expired. Generate a new pairing code and try again. The credential is invalid.",
    );
    expect(pairingFailureMessage("saving", "Secure storage is unavailable.")).toBe(
      "The host accepted the pairing code, but this device could not save the environment. Secure storage is unavailable.",
    );
  });
});
