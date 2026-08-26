# ChatGPT Subscription (Early Access)

ChatGPT Subscription lets T3 Code use a ChatGPT account while T3 remains the agent harness. T3
owns conversation history, streaming, approvals, workspace tools, MCP, and subagents instead of
starting one Codex app-server process for every session.

This provider is **Early Access**. OpenAI documents ChatGPT subscription sign-in, browser and device
code login, account status, and rate-limit discovery for Codex. T3's direct subscription transport
is not a documented public Responses API contract, so a protocol change fails visibly instead of
silently switching provider, account, model, or API-key billing.

- [OpenAI authentication](https://learn.chatgpt.com/docs/auth)
- [Codex app-server login and account protocol](https://learn.chatgpt.com/docs/app-server)
- [ChatGPT plans and Codex usage](https://learn.chatgpt.com/docs/pricing)

## Connect an account

1. Open **Settings > Providers** on the environment that will run the agent.
2. Add or select **ChatGPT Subscription**. It is marked **Early Access**.
3. Select **Connect subscription**.
4. Complete the offered sign-in flow:
   - Local web and desktop environments open the browser flow.
   - Mobile, relay, tunnel, SSH, remote, and headless environments show a verification URL and a
     one-time device code. Device code may need to be enabled in the account or workspace's ChatGPT
     security settings.
5. Confirm that the provider card shows the expected account, plan, and current rate-limit state.

The server stores credentials in an isolated credential home for that provider instance. Access and
refresh tokens never appear in client settings or provider-status messages. Multiple instances can
therefore connect different accounts without sharing their credential state.

## Disconnect or reconnect

Select **Disconnect** and confirm to remove only the selected instance's credential. T3 blocks new
turns for that instance and ends its active turns with a visible interruption. Other ChatGPT
Subscription instances and the existing Codex provider are not changed.

Use **Reconnect** after an expired login or refresh failure. T3 retries a rejected request only after
one coordinated credential refresh. A second rejection returns the instance to **Sign-in required**;
it never falls back to Codex, an API key, another account, or another model.

## Rate limits and concurrency

The provider card reports the account's current rate-limit state and retry timing when OpenAI makes
them available. Subscription and workspace limits still apply. T3 can keep at least 40 managed
sessions responsive, but this is a stability target, not a promise of 40 simultaneous OpenAI model
requests. Active model and tool rounds wait for available memory, server capacity, and account quota.

If the protected memory reserve is threatened, T3 ends one admitted in-process turn with a visible
resource-protection error. It does not silently rerun the request, so a paid request is never repeated
without the user choosing to retry.

## Troubleshooting

- **Device code unavailable:** enable device-code login in ChatGPT security or workspace permissions,
  then retry.
- **Sign-in expired or cancelled:** keep the dialog open to see the failure, then select **Retry**.
- **Rate limited:** wait for the retry time shown on the card. Changing to another provider is always
  an explicit user choice.
- **Provider unavailable after an update:** refresh provider status. Protocol or catalog mismatches
  remain visible and do not use cached fallback models.
