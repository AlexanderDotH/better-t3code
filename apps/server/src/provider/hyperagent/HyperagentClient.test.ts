import { describe, expect, it } from "vite-plus/test";

import { runHyperagentTurn, type FetchLike } from "./HyperagentClient.ts";

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown> | null;
}

function parseBody(init: RequestInit | undefined): Record<string, unknown> | null {
  if (typeof init?.body !== "string") return null;
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("HyperagentClient", () => {
  it("creates isolated turns against the configured Hyperagent base URL", async () => {
    const requests: CapturedRequest[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method, body: parseBody(init) });

      if (url.endsWith("/api/threads") && method === "POST") {
        return Response.json({ id: "thread-1" });
      }
      if (url.endsWith("/api/threads/thread-1") && method === "PATCH") {
        return Response.json({});
      }
      if (url.endsWith("/api/threads/thread-1/chat") && method === "POST") {
        return new Response('data: {"type":"text","content":"done"}\ndata: [DONE]\n', {
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (url.endsWith("/api/threads/thread-1/usage")) {
        return Response.json({
          calculating: false,
          lastCapture: { input_tokens: 2, output_tokens: 3 },
          totals: { total_cost_usd: 0.01 },
        });
      }

      throw new Error(`Unexpected Hyperagent test request: ${method} ${url}`);
    };

    const result = await runHyperagentTurn({
      sessionCookie: "session-token",
      baseUrl: "https://hyperagent.local/",
      modelId: "sonnet-latest",
      content: "hello",
      fastMode: true,
      fetchImpl,
    });

    expect(result.text).toBe("done");
    expect(requests.every((request) => request.url.startsWith("https://hyperagent.local/"))).toBe(
      true,
    );

    const settingsPatch = requests.find(
      (request) => request.method === "PATCH" && request.body?.modelId === "sonnet-latest",
    );
    expect(settingsPatch?.body).toMatchObject({
      modelId: "sonnet-latest",
      fastMode: true,
      executionMode: "auto",
      integrationMode: "disabled",
      enabledIntegrations: [],
      enableThreadSearch: false,
    });

    const chat = requests.find((request) => request.url.endsWith("/chat"));
    expect(chat?.body).toMatchObject({
      content: "hello",
      integrationMode: "disabled",
      enableThreadSearch: false,
      enablePersistentSandbox: false,
      enabledIntegrations: [],
    });
  });
});
