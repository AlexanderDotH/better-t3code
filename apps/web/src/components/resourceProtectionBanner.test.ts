import { EnvironmentId, type ResourceProtectionSnapshot, ThreadId } from "@t3tools/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerBannerStack } from "./chat/ComposerBannerStack.tsx";
import { buildResourceProtectionBanner } from "./resourceProtectionBanner.ts";

const environmentId = EnvironmentId.make("environment-resource");
const threadId = ThreadId.make("thread-resource");

function snapshot(state: ResourceProtectionSnapshot["state"]): ResourceProtectionSnapshot {
  return {
    state,
    totalMemoryBytes: 32 * 1024 ** 3,
    availableMemoryBytes: 5 * 1024 ** 3,
    reservedMemoryBytes: 4 * 1024 ** 3,
    coreReserveBytes: 6 * 1024 ** 3,
    waitingStarts: state === "waiting" ? 1 : 0,
    affectedThreadIds: [threadId],
    affectedThreadIdsTruncated: false,
  };
}

describe("resourceProtectionBanner", () => {
  it("maps waiting and throttled server authority to the English web banner", () => {
    expect(
      buildResourceProtectionBanner({ environmentId, threadId, snapshot: snapshot("waiting") }),
    ).toMatchObject({
      variant: "info",
      urgent: false,
      title: "Subagent waiting for memory",
    });
    expect(
      buildResourceProtectionBanner({ environmentId, threadId, snapshot: snapshot("throttled") }),
    ).toMatchObject({
      variant: "warning",
      urgent: true,
      title: "Provider temporarily throttled",
      className: "resource-protection-banner-surface",
    });
  });

  it("uses the resolved German interface language", () => {
    expect(
      buildResourceProtectionBanner({
        environmentId,
        threadId,
        snapshot: snapshot("throttled"),
        language: "de",
      }),
    ).toMatchObject({
      title: "Provider vorübergehend gedrosselt",
      description: "T3 setzt den Provider nach fünf gesunden Speichermessungen automatisch fort.",
    });
  });

  it("uses the resolved French interface language", () => {
    expect(
      buildResourceProtectionBanner({
        environmentId,
        threadId,
        snapshot: snapshot("waiting"),
        language: "fr",
      }),
    ).toMatchObject({
      title: "Sous-agent en attente de mémoire",
      description:
        "Le démarrage reprend automatiquement lorsque la mémoire est disponible ; l’arrêt reste possible à tout moment.",
    });
  });

  it("stays hidden when protection is disabled or no longer affects the thread", () => {
    expect(buildResourceProtectionBanner({ environmentId, threadId, snapshot: null })).toBeNull();
    expect(
      buildResourceProtectionBanner({ environmentId, threadId, snapshot: snapshot("normal") }),
    ).toBeNull();
    expect(
      buildResourceProtectionBanner({
        environmentId,
        threadId: ThreadId.make("thread-other"),
        snapshot: snapshot("waiting"),
      }),
    ).toBeNull();
  });

  it("places the warning hook and ComposerBanner variables on the same attached surface", () => {
    const resourceBanner = buildResourceProtectionBanner({
      environmentId,
      threadId,
      snapshot: snapshot("throttled"),
    });
    expect(resourceBanner).not.toBeNull();
    if (!resourceBanner) return;

    const markup = renderToStaticMarkup(
      createElement(ComposerBannerStack, {
        items: [
          {
            ...resourceBanner,
            icon: createElement("span", { "aria-hidden": true }),
          },
        ],
      }),
    );

    expect(markup).toContain('data-composer-banner-surface="attached"');
    expect(markup).toContain('data-variant="warning"');
    expect(markup).toContain("resource-protection-banner-surface");
    expect(markup).toContain("[--chat-composer-attached-outline:");
    expect(markup).toContain("[--chat-composer-attached-tint:");
  });
});
