import { McpRuntimeError } from "@t3tools/contracts";
import * as Result from "effect/Result";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as UrlParams from "effect/http/UrlParams";
import * as OpenCode2Client from "./v2/OpenCode2Client.ts";
import { createOpenCode1McpClient, createOpenCode2McpClient } from "./OpenCodeMcpClients.ts";

it.effect(
  "uses OpenCode 1.x SDK directory-scoped status, resources, OAuth and live configuration APIs",
  () =>
    Effect.gen(function* () {
      const requests: Array<{ method: string; path: string; directory: string | null }> = [];
      const client = createOpencodeClient({
        baseUrl: "http://opencode.invalid",
        fetch: async (input, init) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          requests.push({
            method: request.method,
            path: url.pathname,
            directory: url.searchParams.get("directory"),
          });
          if (url.pathname.includes("/auth"))
            return Response.json({ authorizationUrl: "https://oauth.invalid/start" });
          if (url.pathname.includes("/resource"))
            return Response.json({
              guide: { client: "docs", name: "Guide", uri: "docs://guide" },
              other: { client: "other", name: "Other", uri: "other://guide" },
            });
          return Response.json({ docs: { status: "needs_auth" } });
        },
      });
      const api = createOpenCode1McpClient(client, "/project");
      assert.deepEqual(yield* api.statuses, [
        { name: "docs", status: "needs_auth", canAuthorize: true },
      ]);
      assert.equal((yield* api.details!("docs")).resources.length, 1);
      assert.equal(yield* api.authorize!("docs", Effect.void), "https://oauth.invalid/start");
      yield* api.reconnect("docs", Effect.void);
      yield* api.applyConfiguration(
        { docs: { type: "remote", url: "https://docs.invalid" } },
        { removed: { type: "local", command: ["old"] } },
        Effect.void,
      );
      assert.isTrue(requests.every((request) => request.directory === "/project"));
      assert.isTrue(requests.some((request) => request.path.includes("/removed/disconnect")));
      assert.isTrue(requests.some((request) => request.path.includes("/docs/connect")));
    }),
);

it.effect(
  "uses the OpenCode 2 SDK integration OAuth and resource catalog without exposing other servers",
  () =>
    Effect.gen(function* () {
      const requests: Array<{ method: string; path: string; query: string; body: string }> = [];
      const transport = HttpClient.make((request) =>
        Effect.sync(() => {
          const path = new URL(request.url, "http://opencode.invalid").pathname;
          requests.push({
            method: request.method,
            path,
            query: decodeURIComponent(UrlParams.toString(request.urlParams)),
            body:
              request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
          });
          const location = { directory: "/project" };
          let data: unknown;
          if (path.includes("/oauth"))
            data = {
              attemptID: "attempt-1",
              url: "https://oauth.invalid/start",
              instructions: "Continue",
              mode: "auto",
              time: { created: 1, expires: 2 },
            };
          else if (path.includes("/integration"))
            data = {
              id: "integration-docs",
              name: "Docs",
              methods: [{ id: "oauth", type: "oauth", label: "OAuth" }],
              connections: [],
            };
          else if (path.includes("resource"))
            data = {
              resources: [
                { server: "docs", name: "Guide", uri: "docs://guide" },
                { server: "other", name: "Other", uri: "other://guide" },
              ],
              templates: [{ server: "docs", name: "Document", uriTemplate: "docs://{id}" }],
            };
          else if (request.method === "GET")
            data = [
              {
                name: "docs",
                status: { status: "needs_auth", error: "Authorize" },
                integrationID: "integration-docs",
              },
            ];
          return HttpClientResponse.fromWeb(
            request,
            data === undefined
              ? new Response(null, { status: 204 })
              : Response.json({ location, data }),
          );
        }),
      );
      const connection = yield* OpenCode2Client.OpenCode2Client.pipe(
        Effect.flatMap((service) =>
          service.connect({ baseUrl: "http://opencode.invalid", password: "private" }),
        ),
        Effect.provide(
          OpenCode2Client.layer.pipe(
            Layer.provide(Layer.succeed(HttpClient.HttpClient, transport)),
          ),
        ),
      );
      const api = createOpenCode2McpClient(
        () => connection.client,
        () => "/project",
      );
      assert.equal((yield* api.statuses)[0]?.canAuthorize, true);
      const details = yield* api.details!("docs");
      assert.equal(details.resources.length, 1);
      assert.equal(details.templates.length, 1);
      assert.equal(yield* api.authorize!("docs", Effect.void), "https://oauth.invalid/start");
      yield* api.reconnect("docs", Effect.void);
      const connectedBefore = requests.filter((request) =>
        request.path.endsWith("/connect"),
      ).length;
      const stale = yield* api
        .reconnect(
          "docs",
          Effect.fail(
            new McpRuntimeError({ code: "session-replaced", detail: "The runtime was replaced." }),
          ),
        )
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(stale));
      assert.equal(
        requests.filter((request) => request.path.endsWith("/connect")).length,
        connectedBefore,
      );
      yield* api.applyConfiguration(
        { disabled: { type: "local", command: ["tool"], enabled: false } },
        { removed: { type: "local", command: ["old"] } },
        Effect.void,
      );
      assert.isTrue(
        requests.every((request) => request.query.includes("location[directory]=/project")),
      );
      assert.isTrue(
        requests.some((request) => request.method === "DELETE" && request.path.includes("removed")),
      );
      assert.isTrue(
        requests.some(
          (request) => request.method === "PUT" && request.body.includes('"disabled":true'),
        ),
      );
    }),
);
