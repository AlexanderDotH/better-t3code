import * as Schema from "effect/Schema";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import type {
  PlanParallelismReviewInput,
  PlanParallelismReviewResult,
} from "./planParallelismReview.ts";
import type {
  HarnessChatSyncListInput,
  HarnessChatSyncListResult,
  HarnessChatSyncRunInput,
  HarnessChatSyncRunResult,
  HarnessChatSyncSourcesInput,
  HarnessChatSyncSourcesResult,
  HarnessChatSyncStatusInput,
  HarnessChatSyncStatusResult,
} from "./harnessChatSync.ts";
import {
  DesktopEnvironmentBootstrapSchema,
  DesktopPreviewAnnotationThemeSchema,
  type EnvironmentApi,
} from "./ipc.ts";

describe("DesktopPreviewAnnotationThemeSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopPreviewAnnotationThemeSchema);
  const theme = {
    colorScheme: "dark",
    radius: "8px",
    background: "black",
    foreground: "white",
    popover: "black",
    popoverForeground: "white",
    primary: "blue",
    primaryForeground: "white",
    muted: "gray",
    mutedForeground: "silver",
    accent: "navy",
    accentForeground: "white",
    border: "gray",
    input: "gray",
    ring: "blue",
    fontSans: "sans-serif",
    fontMono: "monospace",
  } as const;

  it("defaults mixed-version annotation payloads to English and preserves French", () => {
    expect(decode(theme).interfaceLanguage).toBe("en");
    expect(decode({ ...theme, interfaceLanguage: "fr" }).interfaceLanguage).toBe("fr");
  });
});

describe("DesktopEnvironmentBootstrapSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopEnvironmentBootstrapSchema);

  it("preserves the concrete running distro separately from the backend id", () => {
    expect(
      decode({
        id: "wsl:default",
        label: "WSL (Ubuntu)",
        runningDistro: "Ubuntu",
        httpBaseUrl: "http://127.0.0.1:3774/",
        wsBaseUrl: "ws://127.0.0.1:3774/",
      }),
    ).toEqual({
      id: "wsl:default",
      label: "WSL (Ubuntu)",
      runningDistro: "Ubuntu",
      httpBaseUrl: "http://127.0.0.1:3774/",
      wsBaseUrl: "ws://127.0.0.1:3774/",
    });
  });

  it("allows non-running and non-WSL bootstraps to report no running distro", () => {
    expect(
      decode({
        id: "primary",
        label: "Windows",
        runningDistro: null,
        httpBaseUrl: null,
        wsBaseUrl: null,
      }).runningDistro,
    ).toBeNull();
  });
});

describe("EnvironmentApi plan reviews", () => {
  it("exposes the typed plan parallelism review operation", () => {
    expectTypeOf<EnvironmentApi["plan"]["reviewParallelism"]>().toEqualTypeOf<
      (input: PlanParallelismReviewInput) => Promise<PlanParallelismReviewResult>
    >();
  });
});

describe("EnvironmentApi harness chat sync", () => {
  it("exposes every environment-scoped sync operation", () => {
    expectTypeOf<EnvironmentApi["harnessChatSync"]["sources"]>().toEqualTypeOf<
      (input?: HarnessChatSyncSourcesInput) => Promise<HarnessChatSyncSourcesResult>
    >();
    expectTypeOf<EnvironmentApi["harnessChatSync"]["list"]>().toEqualTypeOf<
      (input: HarnessChatSyncListInput) => Promise<HarnessChatSyncListResult>
    >();
    expectTypeOf<EnvironmentApi["harnessChatSync"]["run"]>().toEqualTypeOf<
      (input: HarnessChatSyncRunInput) => Promise<HarnessChatSyncRunResult>
    >();
    expectTypeOf<EnvironmentApi["harnessChatSync"]["status"]>().toEqualTypeOf<
      (input: HarnessChatSyncStatusInput) => Promise<HarnessChatSyncStatusResult>
    >();
  });
});
