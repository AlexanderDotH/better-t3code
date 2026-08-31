# Resource protection architecture

> For maintainers. Using T3 Code? See [Resource protection](../user/resource-protection.md).

Status: implemented

## Purpose

Resource protection keeps provider and in-process work within the memory budget of the environment
that owns it. It has two independent optional policies:

- **adaptive admission** delays new work while its reservation would cross the current memory
  reserve;
- **provider-process suspension** temporarily pauses the fastest-growing exact provider process
  tree during sustained critical pressure.

Neither policy replaces lifecycle correctness. Runtime identity fencing, cancellation cleanup,
projection replay, schema validation, authorization, and persisted data integrity remain active when
both policies are disabled.

## Responsibility boundaries

The resource-protection package separates decisions from operating-system effects:

- `ResourceProtectionPolicy` resolves the two Better T3 feature flags without coupling them.
- `ResourceGovernorAdmissionQueue` owns FIFO admission, reservations, measurement completion, and
  waiter removal.
- `ResourceGovernorAdmissionCoordinator` owns deferred waiter completion and lifecycle-facing
  acquire, confirm, release, and interruption flows.
- `ResourceGovernorAdmissionState` projects snapshots, reserve thresholds, pressure, monitoring
  demand, and critical in-process victims.
- `ProviderProcessInventory` owns PID and start-time identities, exact process-tree collection,
  registration state, RSS deltas, and growth projection inputs.
- `ProviderProcessTreeController` owns reversible tree suspension and resume. POSIX suspension rolls
  back partial stops; delegated desktop control preserves the same lease contract.
- `SubagentResourceGovernor` is the coordinator. It serializes state transitions, publishes
  snapshots, completes waiters, invokes process control, and runs shutdown recovery.
- `ResourceProtectionRuntime` wires settings changes, telemetry health, and demand-gated native
  snapshots into that coordinator.
- Native resource telemetry owns sampling and bounded history. The governor consumes snapshots only
  while its demand stream is active.

Provider adapters register process roots and report lifecycle events. They do not make admission or
memory-pressure decisions.

## Admission model

Every request carries its environment-local thread, provider instance, configuration, and retention
identity. The coordinator gives requests monotonically increasing admission IDs and drains them in
FIFO order.

The combined provider-process and in-process wait queue retains at most 256 requests. Those retained
callers keep their shared admission-ID FIFO order; an overflow request is rejected explicitly rather
than enqueued or silently dropped. Interrupting a retained waiter immediately frees one slot for a
replacement, and shutdown resolves every retained waiter through its normal rejected-admission or
empty-lease result.

Unknown provider configurations reserve 4 GiB and are measured one at a time. Once exact samples are
available, future reservations use 1.25 times the observed P95 growth, with the 4 GiB value as the
floor. In-process work uses its declared bounded reservation and maintains per-provider-instance
capacity independently from provider subprocess admission.

Interrupting a waiter removes only that waiter. Releasing a subagent, root turn, in-process lease,
provider registration, or thread releases the matching reservation and immediately re-runs the FIFO
drain. A waiter is never completed from a timer or polling loop.

Disabling adaptive admission is reversible. Existing waiters are completed, reservations owned by
the admission policy are released through the normal transition, and new requests bypass gating.
Re-enabling it applies admission checks to subsequent work.

## Pressure and process suspension

Pressure uses the effective host memory budget after Linux cgroup constraints are applied. The core
reserve is 20 percent of total memory, clamped to 2 through 6 GiB. The in-process emergency reserve is
5 percent, clamped to 0.5 through 2 GiB.

For each exact registered tree, the inventory calculates non-negative RSS growth from consecutive
samples. The pressure projection subtracts five seconds of combined exact growth from available
memory. Two consecutive critical samples are required before intervention.

When provider-process suspension is enabled, the coordinator selects the fastest-growing exact tree.
The lease contains every `(pid, startTimeMs)` identity in the tree. A final identity check happens
immediately before each POSIX signal, so PID reuse fails closed for stop and is a safe no-op for
resume. Partial stop failures are rolled back in reverse order.

The suspended lease is retained until resume is confirmed. Five healthy samples trigger automatic
resume. Missing telemetry, registration removal, thread cancellation, policy disablement, and
shutdown also request resume. If confirmation fails, the same lease remains marked
`resumeRequired`; later samples and shutdown retry it instead of forgetting a possibly paused tree.

If suspension is disabled or no safe suspension candidate exists, sustained emergency pressure may
cancel the largest active in-process reservation through its typed critical-pressure callback. The
governor does not kill provider processes.

## Monitoring demand and idle behavior

The governor publishes a distinct boolean demand stream. Native snapshot streaming is active only
while at least one of these is true:

- an adaptive-admission waiter or measurement exists;
- in-process work is waiting or active under adaptive admission;
- a provider tree is registered while process suspension is enabled;
- a suspended tree still needs recovery.

When the last demand is released, the stream changes back to `false`. The native monitor may remain
available for explicit diagnostics, but resource protection does not retain a recurring snapshot
subscription while idle.

## Remote and mixed-surface behavior

The server is the authority because provider processes, memory counters, cgroup limits, and process
identities belong to its environment. Web, desktop, and mobile clients receive snapshots and change
policy through typed RPC settings. A remote client never signals or enumerates processes on its own
machine.

Older clients can continue without the Better T3 controls. The server preserves correctness
invariants and uses the migrated policy defaults for the installation. Diagnostics expose current
memory, reservations, waiting starts, affected threads, source health, and recovery state without
moving the decision into the UI.

## Verification contracts

Focused behavior tests cover:

- independent policy resolution and reverse-state draining;
- FIFO admission, interrupted waiters, per-provider in-process capacity, and reservation release;
- cgroup-constrained memory budgets and reserve thresholds;
- exact tree inventory, PID reuse fencing, partial-stop rollback, and retryable resume leases;
- pressure projection, critical cancellation, telemetry loss, and shutdown recovery;
- bounded provider event queues under multi-agent load;
- monitoring-demand transitions from idle to active and back to idle.

Tests wait on deferred admissions, streams, and lifecycle receipts. They do not use sleep-based
polling or a running T3 Code instance.
