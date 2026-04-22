import { describe, expect, it, vi } from "vitest";

import { Logger } from "../src/Logger.js";
import { SlackTransport } from "../src/slack/SlackTransport.js";
import { createCapturingLogger } from "./helpers/captureLogger.js";

/**
 * Verifies the fire-and-forget Slack dispatch contract:
 * `log.<level>(..., { slack: true })` must return to the caller without
 * waiting for retries/timeouts; `logger.flush()` is the escape hatch for
 * callers that truly need delivery confirmation (shutdown, tests).
 */
describe("Logger + Slack (fire-and-forget)", () => {
  function makeLoggerWithSlowSlack() {
    // Create the transport and gate its fetch so we can observe timing.
    const slack = new SlackTransport(
      { defaultWebhookUrl: "https://hooks.example.com/d" },
      { hostname: "h", loggerName: "svc", onTransportError: vi.fn() }
    );

    let resolveFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const client = slack as unknown as { webhookClient: { fetchImpl: typeof fetch } };
    const origFetch = client.webhookClient.fetchImpl;
    client.webhookClient.fetchImpl = (async () => {
      await fetchGate;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const captured = createCapturingLogger({ name: "svc" });
    // Swap the Logger's transport for our slow one. Uses the same constructor
    // path Logger.child() uses.
    const logger = new Logger(
      { name: "svc" },
      (captured.logger as unknown as { pino: ConstructorParameters<typeof Logger>[1] }).pino,
      slack
    );

    return {
      logger,
      slack,
      releaseFetch: resolveFetch,
      restoreFetch: () => {
        client.webhookClient.fetchImpl = origFetch;
      },
    };
  }

  it("log.error returns before the Slack HTTP call resolves", async () => {
    const { logger, releaseFetch } = makeLoggerWithSlowSlack();
    const start = Date.now();

    await logger.error("boom", { slack: true });

    const elapsed = Date.now() - start;
    // The awaitable returned by log() must resolve promptly, not block on
    // the gated fetch. Generous upper bound to keep the test stable on CI.
    expect(elapsed).toBeLessThan(50);

    // Release the in-flight send so we don't leave it dangling.
    releaseFetch();
    await logger.flush();
  });

  it("logger.flush() waits for the pending Slack send to complete", async () => {
    const { logger, slack, releaseFetch } = makeLoggerWithSlowSlack();

    await logger.error("boom", { slack: true });

    // Confirm there is in-flight work before flush.
    const pendingSize = (slack as unknown as { pending: Set<unknown> }).pending.size;
    expect(pendingSize).toBe(1);

    let flushSettled = false;
    const flushPromise = logger.flush().then(() => {
      flushSettled = true;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(flushSettled).toBe(false);

    releaseFetch();
    await flushPromise;
    expect(flushSettled).toBe(true);
    expect((slack as unknown as { pending: Set<unknown> }).pending.size).toBe(0);
  });

  it("a failing Slack send never throws from log() or flush()", async () => {
    const onTransportError = vi.fn();
    const slack = new SlackTransport(
      {
        defaultWebhookUrl: "https://hooks.example.com/d",
        retry: { attempts: 1, baseDelayMs: 1, timeoutMs: 50 },
      },
      { hostname: "h", loggerName: "svc", onTransportError }
    );
    (slack as unknown as { webhookClient: { fetchImpl: typeof fetch } }).webhookClient.fetchImpl =
      (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;

    const captured = createCapturingLogger({ name: "svc" });
    const logger = new Logger(
      { name: "svc" },
      (captured.logger as unknown as { pino: ConstructorParameters<typeof Logger>[1] }).pino,
      slack
    );

    await expect(logger.error("boom", { slack: true })).resolves.toBeUndefined();
    await expect(logger.flush()).resolves.toBeUndefined();
    expect(onTransportError).toHaveBeenCalled();
  });
});
