import type * as NodeOS from "node:os";

import { it } from "@effect/vitest";
import * as Net from "@t3tools/shared/Net";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { describe, expect } from "vite-plus/test";

import * as AiEndpointDiscovery from "./AiEndpointDiscovery.ts";

const ipv4 = (address: string, netmask: string): NodeOS.NetworkInterfaceInfo => ({
  address,
  netmask,
  family: "IPv4",
  mac: "a8:5e:45:00:00:01",
  internal: false,
  cidr: null,
});

const makeDiscovery = (
  input: {
    readonly interfaces?: typeof NodeOS.networkInterfaces;
    readonly hasListener?: Net.NetServiceShape["hasListenerOnHost"];
    readonly client?: HttpClient.HttpClient;
  } = {},
) =>
  AiEndpointDiscovery.make.pipe(
    Effect.provideService(AiEndpointDiscovery.NetworkInterfaces, input.interfaces ?? (() => ({}))),
    Effect.provideService(Net.NetService, {
      ...Net.make(),
      hasListenerOnHost: input.hasListener ?? (() => Effect.succeed(false)),
    }),
    Effect.provideService(
      HttpClient.HttpClient,
      input.client ??
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
        ),
    ),
  );

describe("resolveDiscoveryHosts", () => {
  it.each(["en0", "eth0", "Ethernet 2", "Local Area Connection", "Wi-Fi"])(
    "includes the physical interface named %s",
    (name) => {
      expect(
        AiEndpointDiscovery.resolveDiscoveryHosts({
          [name]: [ipv4("192.168.1.2", "255.255.255.252")],
        }),
      ).toEqual({
        hosts: ["127.0.0.1", "::1", "192.168.1.1", "192.168.1.2"],
        limited: false,
      });
    },
  );

  it("includes every usable host in the actual /22, including interior .0 and .255 addresses", () => {
    const plan = AiEndpointDiscovery.resolveDiscoveryHosts({
      en0: [ipv4("192.168.3.20", "255.255.252.0")],
    });

    expect(plan.hosts).toHaveLength(1024);
    expect(plan.hosts.slice(0, 3)).toEqual(["127.0.0.1", "::1", "192.168.0.1"]);
    expect(plan.hosts.at(-1)).toBe("192.168.3.254");
    expect(plan.hosts).toContain("192.168.1.0");
    expect(plan.hosts).toContain("192.168.1.255");
    expect(plan.hosts).not.toContain("192.168.0.0");
    expect(plan.hosts).not.toContain("192.168.3.255");
    expect(plan.limited).toBe(false);
  });

  it.each([
    { mask: "255.255.255.252", hosts: ["10.0.0.5", "10.0.0.6"] },
    { mask: "255.255.255.254", hosts: ["10.0.0.4", "10.0.0.5"] },
    { mask: "255.255.255.255", hosts: ["10.0.0.5"] },
  ])("honors narrow subnet boundaries for $mask", ({ mask, hosts }) => {
    expect(AiEndpointDiscovery.resolveDiscoveryHosts({ eth0: [ipv4("10.0.0.5", mask)] })).toEqual({
      hosts: ["127.0.0.1", "::1", ...hosts],
      limited: false,
    });
  });

  it("uses only the local /24 on larger networks and marks the result limited", () => {
    const plan = AiEndpointDiscovery.resolveDiscoveryHosts({
      en0: [ipv4("10.20.30.40", "255.0.0.0")],
    });

    expect(plan.hosts).toHaveLength(256);
    expect(plan.hosts[2]).toBe("10.20.30.1");
    expect(plan.hosts.at(-1)).toBe("10.20.30.254");
    expect(plan.limited).toBe(true);
  });

  it("deduplicates overlapping networks and caps all LAN addresses together", () => {
    const plan = AiEndpointDiscovery.resolveDiscoveryHosts({
      en0: [ipv4("192.168.0.20", "255.255.252.0")],
      en1: [ipv4("192.168.2.20", "255.255.252.0")],
      en2: [ipv4("172.16.0.20", "255.255.255.0")],
    });

    expect(plan.hosts).toHaveLength(1026);
    expect(new Set(plan.hosts).size).toBe(1026);
    expect(plan.hosts.slice(-2)).toEqual(["172.16.0.1", "172.16.0.2"]);
    expect(plan.limited).toBe(true);
  });

  it("excludes internal, non-private, IPv6 LAN, VPN, tunnel, container and virtual interfaces", () => {
    const excludedNames = [
      "lo",
      "lo0",
      "Loopback Pseudo-Interface 1",
      "utun0",
      "tun0",
      "tap0",
      "Tailscale",
      "wg0",
      "ppp0",
      "isatap0",
      "OpenVPN TAP-Windows6",
      "Proton VPN",
      "Wintun Userspace Tunnel",
      "Ethernet (VPN)",
      "Mullvad Tunnel",
      "docker0",
      "br-abcd",
      "br0",
      "virbr0",
      "veth123",
      "vboxnet0",
      "VirtualBox Host-Only Network",
      "vmnet1",
      "vEthernet (WSL)",
      "bridge100",
      "awdl0",
    ];
    const plan = AiEndpointDiscovery.resolveDiscoveryHosts({
      ...Object.fromEntries(
        excludedNames.map((name) => [name, [ipv4("10.1.2.3", "255.255.255.0")]]),
      ),
      en0: [
        { ...ipv4("192.168.1.2", "255.255.255.0"), internal: true },
        ipv4("100.100.100.100", "255.192.0.0"),
        ipv4("8.8.8.8", "255.255.255.0"),
        ipv4("172.32.0.1", "255.255.255.0"),
        ipv4("10.0.0.1", "255.0.255.0"),
        {
          address: "fd00::1",
          netmask: "ffff:ffff:ffff:ffff::",
          family: "IPv6",
          mac: "a8:5e:45:00:00:01",
          internal: false,
          cidr: "fd00::1/64",
          scopeid: 0,
        },
      ],
    });

    expect(plan).toEqual({ hosts: ["127.0.0.1", "::1"], limited: false });
  });
});

it.effect(
  "verifies model responses and keeps auth challenges unconfirmed without sending credentials",
  () =>
    Effect.gen(function* () {
      const requests: Array<string> = [];
      const discovery = yield* makeDiscovery({
        hasListener: (port, host) => Effect.succeed(host === "127.0.0.1" || port === 1337),
        client: HttpClient.make((request, url) => {
          requests.push(url.toString());
          expect(request.headers.authorization).toBeUndefined();
          expect(request.headers.cookie).toBeUndefined();
          expect(request.method).toBe("GET");
          let response = new Response(null, { status: 404 });
          if (url.port === "1234" && url.pathname === "/api/v1/models") {
            response = Response.json({
              models: [{ key: "qwen3", type: "llm", display_name: "Qwen 3" }],
            });
          } else if (url.port === "11434" && url.pathname === "/v1/models") {
            response = Response.json({ data: [{ id: "llama3" }] });
          } else if (url.port === "8080") {
            response = Response.json({ data: [{ not_a_model: true }] });
          } else if (url.port === "8000") {
            response = new Response("<html>unrelated service</html>");
          } else if (
            url.port === "1337" &&
            (url.hostname === "[::1]" || url.pathname === "/api/v1/models")
          ) {
            response = new Response(null, { status: 401 });
          }
          return Effect.succeed(HttpClientResponse.fromWeb(request, response));
        }),
      });

      const events = yield* discovery.discover({}).pipe(Stream.runCollect);
      const complete = events.at(-1);

      expect(complete).toMatchObject({
        status: "complete",
        scanned: 10,
        total: 10,
        limited: false,
      });
      expect(complete?.endpoints).toEqual([
        expect.objectContaining({
          baseUrl: "http://[::1]:1337/v1",
          kind: "openaiCompatible",
          verified: false,
          requiresApiKey: true,
          models: [],
        }),
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:11434/v1",
          kind: "openaiCompatible",
          verified: true,
          requiresApiKey: false,
          models: [expect.objectContaining({ id: "llama3" })],
        }),
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:1234/v1",
          kind: "lmstudio",
          verified: true,
          requiresApiKey: false,
          models: [expect.objectContaining({ id: "qwen3", name: "Qwen 3" })],
        }),
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:1337/v1",
          kind: "openaiCompatible",
          verified: false,
          requiresApiKey: true,
          models: [],
        }),
      ]);
      expect(requests.every((url) => new URL(url).pathname.endsWith("/models"))).toBe(true);
    }).pipe(Effect.scoped),
);

it.effect("caches completed results for 60 seconds and bypasses them on refresh", () =>
  Effect.gen(function* () {
    let probes = 0;
    const discovery = yield* makeDiscovery({
      hasListener: () =>
        Effect.sync(() => {
          probes++;
          return false;
        }),
    });

    const first = yield* discovery.discover({}).pipe(Stream.runCollect);
    const cached = yield* discovery.discover({}).pipe(Stream.runCollect);
    expect(cached).toEqual([first.at(-1)]);
    expect(probes).toBe(10);

    yield* discovery.discover({ refresh: true }).pipe(Stream.runDrain);
    expect(probes).toBe(20);
    yield* TestClock.adjust("59999 millis");
    yield* discovery.discover({}).pipe(Stream.runDrain);
    expect(probes).toBe(20);
    yield* TestClock.adjust("1 millis");
    yield* discovery.discover({}).pipe(Stream.runDrain);
    expect(probes).toBe(30);
  }).pipe(Effect.scoped),
);

it.effect("probes only the specified ports and exposes the LAN scan limit to clients", () =>
  Effect.gen(function* () {
    const probes: Array<{ host: string; port: number }> = [];
    const discovery = yield* makeDiscovery({
      interfaces: () => ({ en0: [ipv4("10.20.30.40", "255.0.0.0")] }),
      hasListener: (port, host) =>
        Effect.sync(() => {
          probes.push({ host, port });
          return false;
        }),
    });
    const events = yield* discovery.discover({}).pipe(Stream.runCollect);

    expect(events[0]).toMatchObject({ status: "scanning", limited: true, total: 1280 });
    expect(events.at(-1)).toMatchObject({ status: "complete", limited: true, scanned: 1280 });
    expect(new Set(probes.map(({ port }) => port))).toEqual(
      new Set([1234, 11434, 8080, 8000, 1337]),
    );
    expect(probes.filter(({ host }) => host === "127.0.0.1" || host === "::1")).toHaveLength(10);
    expect(probes.some(({ host }) => host === "10.20.30.1")).toBe(true);
    expect(probes.some(({ host }) => host === "10.20.30.254")).toBe(true);
    expect(probes.some(({ host }) => host === "10.20.31.1")).toBe(false);
  }).pipe(Effect.scoped),
);

it.effect(
  "shares an active scan with refresh callers and keeps it alive until the last subscriber leaves",
  () =>
    Effect.gen(function* () {
      const probesStarted = yield* Deferred.make<void>();
      const releaseProbes = yield* Deferred.make<void>();
      const firstSubscribed = yield* Deferred.make<void>();
      const secondSubscribed = yield* Deferred.make<void>();
      let probes = 0;
      let released = 0;
      const discovery = yield* makeDiscovery({
        hasListener: () =>
          Effect.gen(function* () {
            probes++;
            if (probes === 10) yield* Deferred.succeed(probesStarted, undefined);
            yield* Deferred.await(releaseProbes);
            return false;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                released++;
              }),
            ),
          ),
      });
      const first = yield* discovery.discover({}).pipe(
        Stream.tap(() => Deferred.succeed(firstSubscribed, undefined)),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(firstSubscribed);
      yield* Deferred.await(probesStarted);
      const second = yield* discovery.discover({ refresh: true }).pipe(
        Stream.tap(() => Deferred.succeed(secondSubscribed, undefined)),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Deferred.await(secondSubscribed);
      yield* Fiber.interrupt(first);
      expect(probes).toBe(10);
      expect(released).toBe(0);

      yield* Deferred.succeed(releaseProbes, undefined);
      const events = yield* Fiber.join(second);
      expect(events.at(-1)).toMatchObject({ status: "complete", scanned: 10 });
      expect(probes).toBe(10);
      expect(released).toBe(10);
    }).pipe(Effect.scoped),
);

it.effect(
  "interrupts outstanding probes when the last subscriber cancels and does not cache the partial scan",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let probes = 0;
      let released = 0;
      const discovery = yield* makeDiscovery({
        hasListener: () =>
          Effect.gen(function* () {
            probes++;
            if (probes === 10) yield* Deferred.succeed(started, undefined);
            if (probes <= 10) yield* Effect.never;
            return false;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                released++;
              }),
            ),
          ),
      });
      const subscriber = yield* discovery.discover({}).pipe(Stream.runDrain, Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(subscriber);
      expect(released).toBe(10);

      const events = yield* discovery.discover({}).pipe(Stream.runCollect);
      expect(events.at(-1)).toMatchObject({ status: "complete", scanned: 10 });
      expect(probes).toBe(20);
    }).pipe(Effect.scoped),
);

it.effect("caps concurrency at 32 and releases the entire scan at its 45-second budget", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    let active = 0;
    let peak = 0;
    let probes = 0;
    const discovery = yield* makeDiscovery({
      interfaces: () => ({ en0: [ipv4("192.168.1.2", "255.255.255.0")] }),
      hasListener: () =>
        Effect.gen(function* () {
          active++;
          probes++;
          peak = Math.max(peak, active);
          if (active === 32) yield* Deferred.succeed(started, undefined);
          return yield* Effect.never;
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              active--;
            }),
          ),
        ),
    });
    const subscriber = yield* discovery.discover({}).pipe(Stream.runCollect, Effect.forkChild);
    yield* Deferred.await(started);
    yield* TestClock.adjust("45 seconds");
    const events = yield* Fiber.join(subscriber);

    expect(peak).toBe(32);
    expect(probes).toBe(32);
    expect(active).toBe(0);
    expect(events.at(-1)).toMatchObject({
      status: "complete",
      scanned: 0,
      total: 1280,
      limited: true,
    });
    expect(events.at(-1)?.message).toContain("45-second");
  }).pipe(Effect.scoped),
);

it.effect("bounds the entire HTTP probe to two seconds and interrupts the HTTP request", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    let released = false;
    const discovery = yield* makeDiscovery({
      hasListener: (port, host) => Effect.succeed(port === 1234 && host === "127.0.0.1"),
      client: HttpClient.make(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              released = true;
            }),
          ),
        ),
      ),
    });
    const subscriber = yield* discovery.discover({}).pipe(Stream.runCollect, Effect.forkChild);
    yield* Deferred.await(started);
    yield* TestClock.adjust("2 seconds");
    const events = yield* Fiber.join(subscriber);

    expect(released).toBe(true);
    expect(events.at(-1)).toMatchObject({ status: "complete", scanned: 10, endpoints: [] });
  }).pipe(Effect.scoped),
);

it.effect("aborts in-flight HTTP requests when the last client cancels discovery", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const signals: Array<AbortSignal> = [];
    const discovery = yield* makeDiscovery({
      hasListener: () => Effect.succeed(true),
      client: HttpClient.make((_request, _url, signal) =>
        Effect.gen(function* () {
          signals.push(signal);
          if (signals.length === 10) yield* Deferred.succeed(started, undefined);
          return yield* Effect.never;
        }),
      ),
    });
    const subscriber = yield* discovery.discover({}).pipe(Stream.runDrain, Effect.forkChild);
    yield* Deferred.await(started);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    yield* Fiber.interrupt(subscriber);

    expect(signals).toHaveLength(10);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  }).pipe(Effect.scoped),
);

it.effect("still checks loopback when network-interface enumeration fails", () =>
  Effect.gen(function* () {
    const discovery = yield* makeDiscovery({
      interfaces: () => {
        throw new Error("unavailable");
      },
    });
    const events = yield* discovery.discover({}).pipe(Stream.runCollect);
    expect(events.at(-1)).toMatchObject({
      status: "complete",
      scanned: 10,
      total: 10,
      limited: true,
    });
    expect(events.at(-1)?.message).toContain("Only loopback");
  }).pipe(Effect.scoped),
);
