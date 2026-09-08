import { describe, expect, it } from "vite-plus/test";

import {
  gitInterfaceCatalog,
  type GitInterfaceMessageKey,
} from "./interfaceLanguageCatalog.git.ts";

const representativeKeys = [
  "git.diff.searchRefs",
  "git.workbench.changeCount",
  "git.workbench.bufferedNavigation",
  "git.operation.forcePush.description",
  "pullRequest.state.merged",
  "pullRequest.checkStatus.running",
  "pullRequest.filter.involvement.reviewing",
  "pullRequest.review.submitFailed",
  "pullRequest.list.searchPlaceholder",
] as const satisfies readonly GitInterfaceMessageKey[];

describe("Git and pull request interface language catalog", () => {
  it("owns complete English, German, and French messages", () => {
    expect(new Set(gitInterfaceCatalog.keys).size).toBe(gitInterfaceCatalog.keys.length);
    expect(representativeKeys.every((key) => gitInterfaceCatalog.keys.includes(key))).toBe(true);
    for (const language of ["en", "de", "fr"] as const) {
      for (const key of gitInterfaceCatalog.keys) {
        expect(gitInterfaceCatalog.messages[language][key]).toBeDefined();
      }
    }
  });

  it("keeps repository and user-authored content outside the UI catalog", () => {
    expect(
      gitInterfaceCatalog.keys.some((key) =>
        /branchName|refName|rawPath|diffContent|commitText|providerResponse|userContent/u.test(key),
      ),
    ).toBe(false);
  });

  it("preserves the product language for provider-neutral Git and pull-request states", () => {
    expect(gitInterfaceCatalog.messages.en["git.workbench.bufferedNavigation"]).toContain(
      "edits waiting",
    );
    expect(gitInterfaceCatalog.messages.en["pullRequest.state.merged"]).toBe("Merged");
    expect(gitInterfaceCatalog.messages.en["pullRequest.checkStatus.running"]).toBe("Running");
    expect(gitInterfaceCatalog.messages.en["pullRequest.filter.involvement.reviewing"]).toBe(
      "Reviewing",
    );
  });
});
