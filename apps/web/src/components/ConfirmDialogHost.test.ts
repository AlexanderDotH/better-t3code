import { describe, expect, it } from "vite-plus/test";

import { resolveConfirmDialogCopy } from "./ConfirmDialogHost";

describe("resolveConfirmDialogCopy", () => {
  it("uses localized fallback copy without translating caller-provided content", () => {
    const fallback = {
      title: "Aktion bestätigen",
      description: "Diese Aktion erfordert eine Bestätigung.",
    };

    expect(resolveConfirmDialogCopy("", fallback)).toEqual(fallback);
    expect(
      resolveConfirmDialogCopy("Repository löschen?\nBleibt nicht erhalten.", fallback),
    ).toEqual({
      title: "Repository löschen?",
      description: "Bleibt nicht erhalten.",
    });
  });
});
