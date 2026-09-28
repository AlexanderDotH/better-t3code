import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerBannerStack } from "../chat/ComposerBannerStack";
import { Alert } from "./alert";
import {
  NotificationSuppressionProvider,
  shouldSuppressNotification,
} from "./notificationSuppression";

describe("notification suppression", () => {
  it("suppresses only error and warning severities", () => {
    expect(shouldSuppressNotification("warning", true)).toBe(true);
    expect(shouldSuppressNotification("error", true)).toBe(true);
    expect(shouldSuppressNotification("info", true)).toBe(false);
    expect(shouldSuppressNotification("warning", false)).toBe(false);
  });

  it("hides classified alerts and composer notices without hiding informational messages", () => {
    const markup = renderToStaticMarkup(
      <NotificationSuppressionProvider enabled>
        <Alert variant="warning">Warning message</Alert>
        <Alert variant="error">Error message</Alert>
        <Alert variant="info">Information message</Alert>
        <ComposerBannerStack
          items={[
            { id: "warning", variant: "warning", icon: null, title: "Warning notice" },
            { id: "info", variant: "info", icon: null, title: "Information notice" },
          ]}
        />
      </NotificationSuppressionProvider>,
    );

    expect(markup).not.toContain("Warning message");
    expect(markup).not.toContain("Error message");
    expect(markup).not.toContain("Warning notice");
    expect(markup).toContain("Information message");
    expect(markup).toContain("Information notice");
  });
});
