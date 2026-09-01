# Resource protection

Resource protection helps an environment avoid memory exhaustion when several agents, provider
processes, or background tasks run at once. Open **Settings > Better T3 > Resource protection** to
control it. The Diagnostics link opens the live resource view for the selected environment.

## Adaptive admission

Adaptive admission checks the server's current memory budget before new managed work starts. When
memory is tight, new work waits in order instead of competing immediately. Running work keeps its
normal lifecycle, and the waiting count and reserved memory appear in Diagnostics.

Turning adaptive admission off releases its waiting starts and allows subsequent work to start
without this memory gate. Turning it on again applies the check to new work. The setting does not
disable cancellation cleanup, runtime identity checks, authorization, or data integrity.

## Provider-process suspension

Provider-process suspension is a separate policy for sustained critical pressure. T3 Code can
temporarily pause the fastest-growing provider process tree, then resume the same tree after memory
recovers. It verifies process identity before control and keeps retrying a resume if the operating
system cannot confirm it immediately.

Turning the policy off stops new suspensions and requests a safe resume for any tree already paused.
T3 Code does not kill the provider process as part of this policy.

You can use either switch by itself:

- adaptive admission on, suspension off: new work may wait, but provider processes are never paused;
- adaptive admission off, suspension on: new work is not gated, but an exact provider tree may be
  paused during critical pressure;
- both off: optional memory intervention is disabled, while lifecycle and data-safety rules stay on.

## Defaults

On a clean installation, optional Better T3 features start disabled. Upgrades preserve behavior that
was previously implicit, and any value you selected explicitly remains unchanged.

## Diagnostics

Diagnostics shows the environment's effective memory budget, live process tree, current and peak
usage, resource history, collection health, waiting starts, and recovery state. Process commands,
raw server errors, trace content, and instrumented operation names are shown as reported rather than
translated or rewritten.

Resource sampling stops being retained by the protection policy when no gated work, registered
provider tree, or recovery lease needs it. Opening Diagnostics can still request live samples for the
page itself.

## Remote connections

Protection always runs on the server that owns the environment. This is also true over LAN, relay,
or tunnel connections. A web, desktop, phone, or tablet client only displays the server's state and
changes its setting; it does not inspect or control processes on the client device.

If native telemetry becomes unavailable, Diagnostics reports that state and adaptive starts wait for
a fresh authoritative sample. A possibly paused process tree remains tracked for recovery. Use the
retry action in Diagnostics after fixing the monitor or connection problem.
