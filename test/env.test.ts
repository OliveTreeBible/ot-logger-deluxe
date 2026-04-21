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
});
