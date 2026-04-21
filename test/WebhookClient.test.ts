import { describe, expect, it } from "vitest";

import { WebhookClient } from "../src/slack/WebhookClient.js";

function fakeResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe("WebhookClient", () => {
  it("returns ok on the first 2xx", async () => {
    let calls = 0;
    const client = new WebhookClient({
      attempts: 3,
      baseDelayMs: 1,
      fetchImpl: async () => {
        calls++;
        return fakeResponse(200);
      },
    });

    const res = await client.send("https://hooks.slack.com/services/x", {
      text: "hi",
      blocks: [],
    });

    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it("retries on 5xx and succeeds on the third try", async () => {
    let calls = 0;
    const client = new WebhookClient({
      attempts: 3,
      baseDelayMs: 1,
      fetchImpl: async () => {
        calls++;
        if (calls < 3) return fakeResponse(500);
        return fakeResponse(200);
      },
    });

    const res = await client.send("https://hooks.slack.com/services/x", {
      text: "hi",
      blocks: [],
    });

    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(3);
  });

  it("respects Retry-After on 429", async () => {
    let calls = 0;
    const timings: number[] = [];
    const client = new WebhookClient({
      attempts: 2,
      baseDelayMs: 1000,
      fetchImpl: async () => {
        timings.push(Date.now());
        calls++;
        if (calls === 1) return fakeResponse(429, { "retry-after": "0" });
        return fakeResponse(200);
      },
    });

    const res = await client.send("https://hooks.slack.com/services/x", {
      text: "hi",
      blocks: [],
    });

    expect(res.ok).toBe(true);
    expect(timings).toHaveLength(2);
    const gap = timings[1]! - timings[0]!;
    expect(gap).toBeLessThan(900);
  });

  it("does not retry 4xx (except 429)", async () => {
    let calls = 0;
    const client = new WebhookClient({
      attempts: 5,
      baseDelayMs: 1,
      fetchImpl: async () => {
        calls++;
        return fakeResponse(400);
      },
    });

    const res = await client.send("https://hooks.slack.com/services/x", {
      text: "hi",
      blocks: [],
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it("retries on thrown network errors", async () => {
    let calls = 0;
    const client = new WebhookClient({
      attempts: 3,
      baseDelayMs: 1,
      fetchImpl: async () => {
        calls++;
        if (calls < 2) throw new Error("ECONNRESET");
        return fakeResponse(200);
      },
    });

    const res = await client.send("https://hooks.slack.com/services/x", {
      text: "hi",
      blocks: [],
    });

    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
  });

  it("gives up after attempts are exhausted", async () => {
    const client = new WebhookClient({
      attempts: 2,
      baseDelayMs: 1,
      fetchImpl: async () => fakeResponse(502),
    });

    const res = await client.send("https://hooks.slack.com/services/x", {
      text: "hi",
      blocks: [],
    });

    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(2);
    expect(res.status).toBe(502);
  });
});
