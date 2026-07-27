import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ExecutionEnvironmentCapabilities } from "./environment.ts";

const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);

describe("ExecutionEnvironmentCapabilities", () => {
  it("defaults mid-chat provider switching to false for legacy descriptors", () => {
    expect(decodeCapabilities({ repositoryIdentity: true })).toEqual({
      repositoryIdentity: true,
      midChatProviderSwitching: false,
    });
  });

  it("accepts an advertised mid-chat provider switching capability", () => {
    expect(
      decodeCapabilities({
        repositoryIdentity: true,
        midChatProviderSwitching: true,
      }).midChatProviderSwitching,
    ).toBe(true);
  });
});
