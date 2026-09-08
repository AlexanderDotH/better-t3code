import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { OpenAiDriver } from "./OpenAiDriver.ts";

const decodeOpenAiSettings = Schema.decodeSync(OpenAiDriver.configSchema);

describe("OpenAiDriver", () => {
  it("registers the distinct disabled multi-instance Responses provider", () => {
    expect(OpenAiDriver.driverKind).toBe("openai");
    expect(OpenAiDriver.metadata).toEqual({
      displayName: "OpenAI Responses",
      supportsMultipleInstances: true,
    });
    expect(OpenAiDriver.defaultConfig()).toEqual({ enabled: false });
    expect(decodeOpenAiSettings({})).toEqual({ enabled: false });
    expect(Object.keys(OpenAiDriver.defaultConfig())).toEqual(["enabled"]);
  });
});
