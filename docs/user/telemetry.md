# Product usage data

This fork disables the server's product analytics sender. It does not record or send server product
usage events to PostHog, and no opt-out setting is required.

The [Usage screen](./usage.md) still reads provider history to show your usage and limits. Local
diagnostic logs and requests to your configured providers remain part of normal operation.
