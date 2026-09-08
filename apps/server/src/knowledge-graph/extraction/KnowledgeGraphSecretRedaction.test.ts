import { describe, expect, it } from "vite-plus/test";

import { redactKnowledgeGraphEvidenceExcerpt } from "./KnowledgeGraphSecretRedaction.ts";

describe("knowledge graph evidence redaction", () => {
  it("redacts authorization headers, multiline YAML credentials, and known provider keys", () => {
    const stripeKey = ["sk", "live", "123456789012345678901234"].join("_");
    const redacted = redactKnowledgeGraphEvidenceExcerpt(`
Authorization: Basic dXNlcjpwYXNzd29yZA==
client_secret:
  multiline-secret-value
google_api_key: AIzaSyA123456789012345678901234567890
stripe_key: ${stripeKey}
`);

    expect(redacted).not.toContain("dXNlcjpwYXNzd29yZA");
    expect(redacted).not.toContain("multiline-secret-value");
    expect(redacted).not.toContain("AIzaSyA123456789012345678901234567890");
    expect(redacted).not.toContain(stripeKey);
    expect(redacted).toContain("[REDACTED]");
  });
});
