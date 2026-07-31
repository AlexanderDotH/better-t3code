# Stopping a generation

The stop button uses two stages so an agent gets a chance to finish cleanly without leaving the
user waiting on an unresponsive provider:

1. Select **Stop generation** to request a cooperative stop.
2. Select **Force stop generation** while that request is pending to terminate the active provider
   session immediately.

If the cooperative stop has not settled after five seconds, T3 Code automatically performs the
same force stop. While the force stop is running, the button shows progress and cannot be selected
again. Sending another message remains unavailable until the stop has settled.
