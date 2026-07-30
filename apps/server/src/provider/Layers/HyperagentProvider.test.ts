import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { HYPERAGENT_MODEL_CATALOG } from "../hyperagent/HyperagentCatalog.ts";
import type { HyperagentSettings } from "../hyperagent/HyperagentSettings.ts";
import {
  checkHyperagentProviderStatus,
  makePendingHyperagentProvider,
} from "./HyperagentProvider.ts";

function makeSettings(overrides: Partial<HyperagentSettings> = {}): HyperagentSettings {
  return {
    enabled: true,
    sessionCookie: "session-token",
    baseUrl: "https://hyperagent.local/",
    model: "sonnet-latest",
    fastMode: false,
    customModels: [],
    ...overrides,
  };
}

describe("HyperagentProvider", () => {
  it.effect("exposes the bundled Hyperagent model catalog before auth checks complete", () =>
    Effect.gen(function* () {
      const provider = yield* makePendingHyperagentProvider(makeSettings());
      const slugs = provider.models.map((model) => model.slug);

      expect(slugs).toEqual(HYPERAGENT_MODEL_CATALOG.map((model) => model.id));
      expect(provider.models.find((model) => model.slug === "sonnet-latest")?.name).toBe(
        "Latest (Sonnet)",
      );
    }),
  );

  it.effect("uses the configured base URL while checking status and keeps catalog models", () =>
    Effect.gen(function* () {
      const seenUrls: string[] = [];
      const provider = yield* checkHyperagentProviderStatus(makeSettings(), async (input) => {
        seenUrls.push(input);
        return Response.json({ email: "user@example.test" });
      });

      expect(seenUrls).toEqual(["https://hyperagent.local/api/auth/me"]);
      expect(provider.status).toBe("ready");
      expect(provider.auth.email).toBe("user@example.test");
      expect(provider.models.map((model) => model.slug)).toContain("openai/gpt-5.5");
    }),
  );

  it.effect("keeps a configured model visible even when it is outside the bundled catalog", () =>
    Effect.gen(function* () {
      const provider = yield* makePendingHyperagentProvider(
        makeSettings({ model: "private-preview" }),
      );

      expect(provider.models.map((model) => model.slug)).toContain("private-preview");
    }),
  );
});
