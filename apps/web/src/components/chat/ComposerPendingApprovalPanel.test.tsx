import { ApprovalRequestId } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ComposerPendingApprovalPanel,
  composerApprovalMessageIds,
} from "./ComposerPendingApprovalPanel";

describe("ComposerPendingApprovalPanel", () => {
  it("maps every request kind to typed localized labels", () => {
    const german = createInterfaceTranslator({ language: "de", locale: "de-DE" }).message;
    const french = createInterfaceTranslator({ language: "fr", locale: "fr-FR" }).message;

    expect(german(composerApprovalMessageIds("mcp-elicitation").labelMessageId)).toBe(
      "App-Zugriff genehmigen",
    );
    expect(french(composerApprovalMessageIds("command").labelMessageId)).toBe(
      "Approbation de commande",
    );
    expect(german(composerApprovalMessageIds("file-read").detailMessageId)).toBe(
      "Zu lesende Datei",
    );
    expect(french(composerApprovalMessageIds("file-change").detailMessageId)).toBe(
      "Modification de fichier",
    );
  });

  it("keeps the complete command readable in the compact row", () => {
    const detail = `bun run release -- ${"x".repeat(500)}\nsecond line`;
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-1"),
          requestKind: "command",
          createdAt: "2026-07-18T00:00:00.000Z",
          detail,
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain('data-approval-detail="complete"');
    expect(markup).toContain('aria-label="Command"');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain(detail);
    expect(markup).toContain("max-h-20");
    expect(markup).toContain("overflow-auto");
    expect(markup).toContain("whitespace-pre");
    expect(markup).toContain("[scrollbar-width:thin]");
    expect(markup).toContain("[&amp;::-webkit-scrollbar]:h-1.5");
    expect(markup).not.toContain("truncate");
    expect(markup).not.toContain("line-clamp");
    expect(markup).toContain("min-w-0");
    expect(markup).not.toContain("Command approval requested");
  });

  it("falls back to the approval kind when the provider sends an empty detail", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-2"),
          requestKind: "file-read",
          createdAt: "2026-07-18T00:00:00.000Z",
          detail: "",
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain("File read approval");
  });

  it("shows the app name and message for an MCP access request", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-safari"),
          requestKind: "mcp-elicitation",
          createdAt: "2026-08-24T00:00:00.000Z",
          appName: "Safari",
          detail: "Allow ChatGPT to use Safari?",
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain('aria-label="App access approval"');
    expect(markup).toContain('aria-label="App access request"');
    expect(markup).toContain(">Safari<");
    expect(markup).toContain("Allow ChatGPT to use Safari?");
  });

  it("limits long app names so the complete approval message stays readable", () => {
    const appName = "A".repeat(200);
    const detail = "Allow ChatGPT to access the selected application?";
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-long-app-name"),
          requestKind: "mcp-elicitation",
          createdAt: "2026-08-24T00:00:00.000Z",
          appName,
          detail,
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain("max-w-32 shrink truncate");
    expect(markup).toContain(appName);
    expect(markup).toContain('data-approval-detail="complete"');
    expect(markup).toContain(detail);
  });
});
