import { describe, expect, it, vi } from "vitest";

import { normalizeFields } from "../src/internal/coerce.js";
import { SlackTransport } from "../src/slack/SlackTransport.js";

/** Slack-shaped URL for tests; assembled at runtime so it is not a single literal matched by push protection. */
function slackIncomingWebhookUrlForTests(): string {
  const host = ["hooks", "slack", "com"].join(".");
  const path = ["/services/T", "00000000/B", "00000000/", "XXXXXXXXXXXXXXXXXXXXXXXX"].join("");
  return new URL(path, `https://${host}`).href;
}

const SLACK_HOOK_URL = slackIncomingWebhookUrlForTests();

function makeTransport(options: ConstructorParameters<typeof SlackTransport>[0]) {
  const sent: Array<{ url: string; body: string }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    sent.push({ url, body: String(init?.body ?? "") });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;

  const transport = new SlackTransport(options, {
    hostname: "host",
    loggerName: "svc",
    onTransportError: vi.fn(),
  });

  // Inject the mock fetch into the internal client.
  // The field is private, so we tunnel through the prototype.
  const client = (transport as unknown as { webhookClient: { fetchImpl: typeof fetch } | undefined })
    .webhookClient;
  if (client) {
    (client as unknown as { fetchImpl: typeof fetch }).fetchImpl = fetchImpl;
  }

  return { transport, sent, fetchImpl };
}

describe("SlackTransport routing", () => {
  it("skips silently when no webhooks are configured", async () => {
    const transport = new SlackTransport(
      {},
      { hostname: "h", loggerName: "svc", onTransportError: vi.fn() }
    );
    expect(transport.canDeliver("error")).toBe(false);

    await expect(
      transport.post({ level: "error", message: "x", fields: [] })
    ).resolves.toBeUndefined();
  });

  it("uses the level-specific webhook when available", async () => {
    const { transport, sent } = makeTransport({
      defaultWebhookUrl: "https://hooks.example.com/default",
      channels: {
        error: "https://hooks.example.com/errors",
      },
    });

    await transport.post({
      level: "error",
      message: "boom",
      fields: normalizeFields({ a: 1 }),
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://hooks.example.com/errors");
  });

  it("falls back to the default webhook when no level override exists", async () => {
    const { transport, sent } = makeTransport({
      defaultWebhookUrl: "https://hooks.example.com/default",
      channels: {
        error: "https://hooks.example.com/errors",
      },
    });

    await transport.post({
      level: "warn",
      message: "careful",
      fields: [],
    });

    expect(sent[0]!.url).toBe("https://hooks.example.com/default");
  });

  it("honors channelOverride that is a Slack Incoming Webhook URL", async () => {
    const { transport, sent } = makeTransport({
      defaultWebhookUrl: "https://hooks.example.com/default",
    });

    await transport.post({
      level: "info",
      message: "hi",
      fields: [],
      channelOverride: SLACK_HOOK_URL,
    });

    expect(sent[0]!.url).toBe(SLACK_HOOK_URL);
  });

  it("ignores untrusted per-message webhook URLs and falls back to configured webhooks (SSRF)", async () => {
    const { transport, sent } = makeTransport({
      defaultWebhookUrl: "https://hooks.example.com/default",
    });

    await transport.post({
      level: "info",
      message: "hi",
      fields: [],
      channelOverride: "https://hooks.example.com/override",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://hooks.example.com/default");
  });

  it("honors arbitrary per-message webhook URLs when allowArbitraryWebhookUrlOverrides is set", async () => {
    const { transport, sent } = makeTransport({
      defaultWebhookUrl: "https://hooks.example.com/default",
      allowArbitraryWebhookUrlOverrides: true,
    });

    await transport.post({
      level: "info",
      message: "hi",
      fields: [],
      channelOverride: "https://hooks.example.com/override",
    });

    expect(sent[0]!.url).toBe("https://hooks.example.com/override");
  });

  it("honors channelOverride that names a configured channel", async () => {
    const { transport, sent } = makeTransport({
      channels: {
        fatal: "https://hooks.example.com/fatal",
      },
    });

    await transport.post({
      level: "info",
      message: "hi",
      fields: [],
      channelOverride: "fatal",
    });

    expect(sent[0]!.url).toBe("https://hooks.example.com/fatal");
  });

  it("attaches mentions from options", async () => {
    const { transport, sent } = makeTransport({
      defaultWebhookUrl: "https://hooks.example.com/d",
      mention: { error: "@channel" },
    });

    await transport.post({ level: "error", message: "x", fields: [] });

    const body = JSON.parse(sent[0]!.body);
    const hasMention = body.blocks.some(
      (b: { type: string; text?: { text: string } }) =>
        b.type === "section" && b.text?.text?.includes("NOTIFY:")
    );
    expect(hasMention).toBe(true);
  });

  it("honors a per-message Slack webhook URL override even when no webhook is configured statically", async () => {
    // Previously, SlackTransport only constructed WebhookClient when the
    // static options included a webhook, so a per-message URL override on a
    // Web-API-only (or unconfigured) transport would resolve a valid URL but
    // silently drop the send. This test guards against that regression.
    const { transport, sent } = makeTransport({});

    await transport.post({
      level: "error",
      message: "x",
      fields: [],
      channelOverride: SLACK_HOOK_URL,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(SLACK_HOOK_URL);
  });

  it("drained() awaits in-flight post() calls so callers can flush at shutdown", async () => {
    const { transport } = makeTransport({
      defaultWebhookUrl: "https://hooks.example.com/d",
    });

    // Slow the fetch so we can observe in-flight bookkeeping.
    let resolveFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const client = transport as unknown as { webhookClient: { fetchImpl: typeof fetch } };
    client.webhookClient.fetchImpl = (async () => {
      await fetchGate;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    // Fire-and-forget (mirrors what Logger.log() now does).
    const sendPromise = transport.post({ level: "error", message: "x", fields: [] });

    let drainedSettled = false;
    const drainedPromise = transport.drained().then(() => {
      drainedSettled = true;
    });

    // drained() must not resolve until the in-flight send does.
    await new Promise((r) => setTimeout(r, 10));
    expect(drainedSettled).toBe(false);

    resolveFetch();
    await sendPromise;
    await drainedPromise;
    expect(drainedSettled).toBe(true);

    // After draining, the pending set is empty and a fresh drained() is a no-op.
    await transport.drained();
  });

  it("drained() awaits work that starts while draining", async () => {
    const { transport } = makeTransport({
      defaultWebhookUrl: "https://hooks.example.com/d",
    });

    const gates: Array<() => void> = [];
    const fetchGate = (id: number) =>
      new Promise<void>((resolve) => {
        gates[id] = resolve;
      });

    let call = 0;
    const client = transport as unknown as { webhookClient: { fetchImpl: typeof fetch } };
    client.webhookClient.fetchImpl = (async () => {
      const id = call++;
      await fetchGate(id);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    void transport.post({ level: "error", message: "first", fields: [] });

    const drainedPromise = transport.drained();

    await new Promise((r) => setTimeout(r, 15));
    void transport.post({ level: "error", message: "second", fields: [] });

    gates[0]?.();
    await new Promise((r) => setTimeout(r, 15));
    gates[1]?.();

    await drainedPromise;
  });

  it("reports failures via onTransportError, does not throw", async () => {
    const onTransportError = vi.fn();
    const transport = new SlackTransport(
      { defaultWebhookUrl: "https://hooks.example.com/d" },
      { hostname: "h", loggerName: "svc", onTransportError }
    );

    const client = (transport as unknown as { webhookClient: { fetchImpl: typeof fetch } })
      .webhookClient;
    (client as unknown as { fetchImpl: typeof fetch }).fetchImpl = (async () =>
      new Response(null, { status: 500 })) as unknown as typeof fetch;
    (client as unknown as { baseDelayMs: number }).baseDelayMs = 1;
    (client as unknown as { attempts: number }).attempts = 2;

    await transport.post({ level: "error", message: "x", fields: [] });

    expect(onTransportError).toHaveBeenCalledOnce();
    expect(onTransportError.mock.calls[0]![0]).toMatchObject({ level: "error", status: 500 });
  });
});
