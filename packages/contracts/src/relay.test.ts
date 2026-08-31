import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import { RelayApi, RelayDeviceRegistrationRequest } from "./relay.ts";

const registration = {
  deviceId: "device-1",
  label: "Alex's iPhone",
  platform: "ios",
  iosMajorVersion: 18,
  preferences: {
    liveActivitiesEnabled: true,
    notificationsEnabled: true,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  },
} as const;

describe("RelayApi security", () => {
  it("describes DPoP access tokens using the HTTP DPoP authorization scheme", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.components.securitySchemes?.relayDpop).toEqual({
      type: "http",
      scheme: "DPoP",
      description: "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
    });
  });
});

describe("Relay interface-language compatibility", () => {
  const decodeRegistration = Schema.decodeUnknownSync(RelayDeviceRegistrationRequest);

  it("accepts French while preserving registrations from older clients without a language", () => {
    expect(decodeRegistration(registration).language).toBeUndefined();
    expect(decodeRegistration({ ...registration, language: "fr" }).language).toBe("fr");
    expect(() => decodeRegistration({ ...registration, language: "es" })).toThrow();
  });
});
