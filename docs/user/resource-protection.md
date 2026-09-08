# Resource protection

Open **Settings → Better T3 → System** on web or desktop to control memory protection for the
selected environment. Mobile exposes the corresponding controls under **Settings → Better T3**.
The Diagnostics link shows that environment's memory budget and waiting work.

**Adaptive admission** can hold new managed work until enough memory is available. Waiting work
has not started executing. Turning the setting off releases the memory gate; turning it back on
applies it to new starts.

**Provider-process suspension** is separate. On supported hosts it can temporarily pause a provider
process tree during sustained critical pressure, then resume it when memory recovers. Turning it
off stops new suspensions and requests a resume for work already paused.

If work is waiting, check Diagnostics for memory pressure or a failed monitor. Close unnecessary
work on the environment, or retry the monitor after resolving its reported problem. Reducing
parallel agent work can also leave more memory available. Settings that are unavailable on an
older server require an environment update.

These policies run on the machine that hosts the environment. Connecting from a phone, browser,
relay, or tunnel does not apply them to processes on that client device. Disabling a policy does
not remove conversations, checkpoints, or the ordinary stop controls.
