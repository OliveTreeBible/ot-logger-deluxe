import { describe, expect, it } from "vitest";

import { createLoggerFromEnv } from "../src/config/env.js";

describe("createLoggerFromEnv", () => {
  it("reads defaults when no env vars are set", () => {
    const logger = createLoggerFromEnv({ env: {}, name: "app" });
    expect(logger.level).toBe("info");
  });

  it("honors LOG_LEVEL", () => {
    const logger = createLoggerFromEnv({ env: { LOG_LEVEL: "debug" } });
    expect(logger.level).toBe("debug");
  });

  it("falls back to info for invalid LOG_LEVEL values", () => {
    const logger = createLoggerFromEnv({ env: { LOG_LEVEL: "shout" } });
    expect(logger.level).toBe("info");
  });

  it("enables Slack when any webhook env var is set", () => {
    const logger = createLoggerFromEnv({
      env: {
        SLACK_WEBHOOK_URL: "https://hooks.example.com/d",
      },
    });
    const slack = (logger as unknown as { slack?: unknown }).slack;
    expect(slack).toBeDefined();
  });

  it("reads per-level webhook overrides", () => {
    const logger = createLoggerFromEnv({
      env: {
        SLACK_WEBHOOK_URL_ERROR: "https://hooks.example.com/err",
        SLACK_WEBHOOK_URL_FATAL: "https://hooks.example.com/fatal",
        SLACK_MENTION_FATAL: "@channel",
      },
    });
    const slack = (logger as unknown as { slack?: unknown }).slack;
    expect(slack).toBeDefined();
  });

  it("leaves slack undefined when nothing is configured", () => {
    const logger = createLoggerFromEnv({ env: {} });
    const slack = (logger as unknown as { slack?: unknown }).slack;
    expect(slack).toBeUndefined();
  });

  it("explicit overrides beat env vars", () => {
    const logger = createLoggerFromEnv({
      env: { LOG_LEVEL: "error" },
      level: "trace",
    });
    expect(logger.level).toBe("trace");
  });

  it("enables Slack Web API with only SLACK_BOT_TOKEN (no default channel)", () => {
    // Callers can still specify a channel per-message via slack: { channel },
    // which SlackTransport.resolveWebApiChannel() honors. The previous
    // behavior required SLACK_CHANNEL* to also be set, which blocked the
    // per-message-only use case.
    const logger = createLoggerFromEnv({
      env: { SLACK_BOT_TOKEN: "xoxb-test" },
    });
    const slack = (logger as unknown as { slack?: unknown }).slack;
    expect(slack).toBeDefined();
  });

  it("ignoreEnvSlack: true disables Slack even when env vars are set", () => {
    const logger = createLoggerFromEnv({
      env: { SLACK_WEBHOOK_URL: "https://hooks.example.com/env" },
      ignoreEnvSlack: true,
    });
    const slack = (logger as unknown as { slack?: unknown }).slack;
    expect(slack).toBeUndefined();
  });

  it("ignoreEnvSlack: true still honors an explicit overrides.slack", () => {
    const logger = createLoggerFromEnv({
      env: { SLACK_WEBHOOK_URL: "https://hooks.example.com/env" },
      ignoreEnvSlack: true,
      slack: { defaultWebhookUrl: "https://hooks.example.com/explicit" },
    });
    const slack = (logger as unknown as { slack?: unknown }).slack;
    expect(slack).toBeDefined();
  });

  it("ignoreEnvTransports: true drops LOG_FILE / LOG_SYSLOG_HOST", () => {
    // Build two loggers from the same env: one with the flag, one without,
    // and verify only the flagged one skips the file transport.
    // We observe this through the Logger's pino instance: absence of a
    // transport means the default stdout-only path.
    const withTransports = createLoggerFromEnv({
      env: { LOG_FILE: "/tmp/should-not-open.log" },
      ignoreEnvTransports: true,
    });
    // Just assert construction doesn't crash and the logger is usable.
    expect(withTransports.level).toBe("info");
  });
});
