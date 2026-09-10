import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import type {
  AiEndpointCandidate,
  AiEndpointDiscoveryEvent,
  AiEndpointDiscoveryInput,
} from "@t3tools/contracts";
import * as Net from "@t3tools/shared/Net";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as RcRef from "effect/RcRef";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";

import { probeAiEndpoint } from "../openaiCompatible/OpenAiCompatibleTransport.ts";

const DISCOVERY_PORTS = [1234, 11434, 8080, 8000, 1337] as const;
const MAX_LAN_ADDRESSES = 1024;
const PROBE_CONCURRENCY = 32;
const SCAN_TIMEOUT = "45 seconds";
const CACHE_TTL_MS = 60_000;
const LOOPBACK_HOSTS = ["127.0.0.1", "::1"];
// ponytail: node:os exposes names, not adapter types; renamed VPNs need OS-specific metadata.
const EXCLUDED_INTERFACE =
  /^(?:lo(?:opback|\d|$)|utun|tun|tap|tailscale|wg|wireguard|ppp|ipsec|ip[46]tnl|isatap|sit|stf|gif|gre|erspan|docker|br[-\d]|virbr|veth|vbox|virtual|vmnet|vmware|vethernet|bridge|awdl|llw|anpi|ham|zt|zerotier|nordlynx|cni|flannel|cali|cbr|kube|lxc|lxd|incus|podman|vnet)|vpn|wintun|tap-windows|tunnel/i;

export const NetworkInterfaces = Context.Reference<typeof NodeOS.networkInterfaces>(
  "t3/provider/discovery/NetworkInterfaces",
  { defaultValue: () => NodeOS.networkInterfaces },
);

const ipv4Number = (address: string) =>
  address.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);

const ipv4Address = (address: number) =>
  [24, 16, 8, 0].map((shift) => (address >>> shift) & 255).join(".");

const isPrivateIpv4 = (address: number) =>
  address >>> 24 === 10 || address >>> 20 === 0xac1 || address >>> 16 === 0xc0a8;

export function resolveDiscoveryHosts(interfaces: ReturnType<typeof NodeOS.networkInterfaces>) {
  const lan = new Set<string>();
  let limited = false;

  interfaces: for (const [name, entries] of Object.entries(interfaces)) {
    if (EXCLUDED_INTERFACE.test(name)) continue;

    for (const entry of entries ?? []) {
      if (
        entry.internal ||
        entry.family !== "IPv4" ||
        !NodeNet.isIPv4(entry.address) ||
        !NodeNet.isIPv4(entry.netmask)
      ) {
        continue;
      }
      const address = ipv4Number(entry.address);
      if (!isPrivateIpv4(address)) continue;

      const hostMask = ~ipv4Number(entry.netmask) >>> 0;
      if ((hostMask & (hostMask + 1)) !== 0) continue;

      const prefix = Math.clz32(hostMask);
      const scanPrefix = prefix < 22 ? 24 : prefix;
      limited ||= prefix < 22;
      const size = 2 ** (32 - scanPrefix);
      const network = Math.floor(address / size) * size;
      const first = network + (size > 2 ? 1 : 0);
      const last = network + size - (size > 2 ? 2 : 1);

      for (let host = first; host <= last; host++) {
        const candidate = ipv4Address(host);
        if (lan.has(candidate)) continue;
        if (lan.size === MAX_LAN_ADDRESSES) {
          limited = true;
          break interfaces;
        }
        lan.add(candidate);
      }
    }
  }

  return { hosts: [...LOOPBACK_HOSTS, ...lan], limited };
}

export class AiEndpointDiscovery extends Context.Service<
  AiEndpointDiscovery,
  {
    readonly discover: (input: AiEndpointDiscoveryInput) => Stream.Stream<AiEndpointDiscoveryEvent>;
  }
>()("t3/provider/discovery/AiEndpointDiscovery") {}

interface Scan {
  readonly updates: PubSub.PubSub<AiEndpointDiscoveryEvent>;
  latest: AiEndpointDiscoveryEvent;
}

interface ScanResource {
  readonly scope: Scope.Scope;
  scan: Scan | undefined;
}

export const make = Effect.gen(function* () {
  const net = yield* Net.NetService;
  const httpClient = yield* HttpClient.HttpClient;
  const readInterfaces = yield* NetworkInterfaces;
  const selectionLock = yield* Semaphore.make(1);
  let cached: { readonly at: number; readonly event: AiEndpointDiscoveryEvent } | undefined;

  const scans = yield* RcRef.make({
    acquire: Effect.map(Effect.scope, (scope): ScanResource => ({ scope, scan: undefined })),
  });

  const probe = Effect.fn("AiEndpointDiscovery.probe")(function* (target: {
    readonly host: string;
    readonly port: number;
  }) {
    if (!(yield* net.hasListenerOnHost(target.port, target.host))) return undefined;
    const host = target.host.includes(":") ? `[${target.host}]` : target.host;
    return yield* probeAiEndpoint(`http://${host}:${target.port}`).pipe(
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.map((endpoint): AiEndpointCandidate | undefined =>
        endpoint
          ? {
              ...endpoint,
              models: endpoint.models.map(({ id, name }) => ({ id, name })),
            }
          : undefined,
      ),
    );
  });

  const finish = Effect.fn("AiEndpointDiscovery.finish")(function* (scan: Scan, message?: string) {
    const event: AiEndpointDiscoveryEvent = {
      ...scan.latest,
      status: "complete",
      limited: scan.latest.limited || message !== undefined,
      ...(message ? { message } : {}),
    };
    cached = { at: DateTime.toEpochMillis(yield* DateTime.now), event };
    scan.latest = event;
    yield* PubSub.publish(scan.updates, event);
  });

  const runScan = Effect.fn("AiEndpointDiscovery.runScan")(function* (
    scan: Scan,
    hosts: ReadonlyArray<string>,
  ) {
    const targets = hosts.flatMap((host) => DISCOVERY_PORTS.map((port) => ({ host, port })));
    const result = yield* Stream.fromIterable(targets).pipe(
      Stream.mapEffect(probe, { concurrency: PROBE_CONCURRENCY, unordered: true }),
      Stream.runForEach((endpoint) => {
        scan.latest = {
          ...scan.latest,
          scanned: scan.latest.scanned + 1,
          endpoints: endpoint
            ? [...scan.latest.endpoints, endpoint].sort((left, right) =>
                left.baseUrl.localeCompare(right.baseUrl),
              )
            : scan.latest.endpoints,
        };
        return endpoint || scan.latest.scanned % PROBE_CONCURRENCY === 0
          ? PubSub.publish(scan.updates, scan.latest)
          : Effect.void;
      }),
      Effect.timeoutOption(SCAN_TIMEOUT),
    );
    yield* finish(
      scan,
      Option.isNone(result)
        ? "Discovery reached its 45-second limit. Results may be incomplete."
        : undefined,
    );
  });

  const startScan = Effect.fn("AiEndpointDiscovery.startScan")(function* (resource: ScanResource) {
    const plan = yield* Effect.try(() => resolveDiscoveryHosts(readInterfaces())).pipe(
      Effect.orElseSucceed(() => ({
        hosts: LOOPBACK_HOSTS,
        limited: true,
        message: "Network interfaces could not be read. Only loopback was checked.",
      })),
    );
    const updates = yield* PubSub.sliding<AiEndpointDiscoveryEvent>({ capacity: 1, replay: 1 });
    yield* Scope.addFinalizer(resource.scope, PubSub.shutdown(updates));
    const scan: Scan = {
      updates,
      latest: {
        status: "scanning",
        endpoints: [],
        scanned: 0,
        total: plan.hosts.length * DISCOVERY_PORTS.length,
        limited: plan.limited,
        ...("message" in plan ? { message: plan.message } : {}),
      },
    };
    resource.scan = scan;
    yield* PubSub.publish(updates, scan.latest);
    yield* runScan(scan, plan.hosts).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          ? Effect.failCause(cause)
          : finish(scan, "Discovery could not finish. Results may be incomplete."),
      ),
      Effect.forkIn(resource.scope),
    );
    return scan;
  });

  const selectScan = Effect.fn("AiEndpointDiscovery.selectScan")(function* (
    input: AiEndpointDiscoveryInput,
  ) {
    const resource = yield* RcRef.get(scans);
    let scan = resource.scan;
    if (scan?.latest.status !== "scanning") {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      if (!input.refresh && cached && now - cached.at < CACHE_TTL_MS) {
        return Stream.succeed(cached.event);
      }
      scan = yield* startScan(resource);
    }
    return Stream.fromPubSub(scan.updates).pipe(
      Stream.takeUntil((event) => event.status === "complete"),
    );
  }, selectionLock.withPermit);

  return AiEndpointDiscovery.of({ discover: (input) => Stream.unwrap(selectScan(input)) });
});

export const layer = Layer.effect(AiEndpointDiscovery, make);
