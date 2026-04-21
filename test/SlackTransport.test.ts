import { describe, expect, it, vi } from "vitest";

import { normalizeFields } from "../src/internal/coerce.js";
import { SlackTransport } from "../src/slack/SlackTransport.js";

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

  it("honors channelOverride that is a URL", async () => {
    const { transport, sent } = makeTransport({
      defaultWebhookUrl: "https://hooks.example.com/default",
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
