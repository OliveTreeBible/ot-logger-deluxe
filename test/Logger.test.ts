import { describe, expect, it } from "vitest";

import { createCapturingLogger } from "./helpers/captureLogger.js";

describe("Logger", () => {
  it("emits structured JSON with level, time, name, msg", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc", level: "trace" });

    await logger.info("hello");

    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec.msg).toBe("hello");
    expect(rec.name).toBe("svc");
    expect(rec.levelLabel).toBe("info");
    expect(typeof rec.time).toBe("string");
    expect(() => new Date(rec.time as string).toISOString()).not.toThrow();
  });

  it("includes ISO 8601 timestamps for CloudWatch/syslog compatibility", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });

    await logger.info("hi");

    const iso = records[0]!.time as string;
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("respects the configured level", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc", level: "warn" });

    await logger.info("info-msg");
    await logger.debug("debug-msg");
    await logger.warn("warn-msg");
    await logger.error("error-msg");

    expect(records.map((r) => r.msg)).toEqual(["warn-msg", "error-msg"]);
  });

  it("attaches fields as structured data", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });

    await logger.warn("inactive", {
      fields: {
        action_id: 42,
        action: "run",
        group_id: 7,
      },
    });

    expect(records[0]).toMatchObject({
      msg: "inactive",
      action_id: 42,
      action: "run",
      group_id: 7,
    });
  });

  it("coerces Date values to ISO strings in the JSON output", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });
    const when = new Date("2024-01-02T03:04:05.000Z");

    await logger.info("at", {
      fields: {
        when: { value: when, code: true },
      },
    });

    // After JSON.parse, Date values become ISO 8601 strings.
    expect(records[0]!.when).toBe("2024-01-02T03:04:05.000Z");
  });

  it("serializes Errors into err.type/message/stack", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });
    const err = new Error("boom");

    await logger.error("failure", { error: err });

    const rec = records[0]!;
    expect(rec.err).toMatchObject({ type: "Error", message: "boom" });
    expect(typeof (rec.err as { stack?: string }).stack).toBe("string");
  });

  it("captures code blocks on the `code` field", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });

    await logger.error("db", { code: "select 1" });

    expect(records[0]!.code).toBe("select 1");
  });

  it("treats `code: true` as a shorthand for 'inline-code every field'", async () => {
    // The JSON record doesn't show inline-code formatting (that's Slack-only),
    // so we assert on the normalized Field shape that reaches the Slack path.
    const normalizeModule = await import("../src/internal/coerce.js");
    const fields = normalizeModule.normalizeFields(
      { action_id: 1, group_name: "beta" },
      true
    );
    expect(fields.every((f) => f.code === true)).toBe(true);

    // End-to-end: the call must not throw and must emit one record.
    const { logger, records } = createCapturingLogger({ name: "svc" });
    await logger.warn("inactive", {
      fields: { action_id: 1, group_name: "beta" },
      code: true,
    });
    expect(records).toHaveLength(1);
    // `code: true` must NOT leak a stray `code` string into the JSON output.
    expect(records[0]!.code).toBeUndefined();
  });

  it("child loggers merge bindings into every record", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });
    const child = logger.child({ requestId: "abc" });

    await child.info("hi");

    expect(records[0]).toMatchObject({ msg: "hi", requestId: "abc", name: "svc" });
  });

  it("supports runtime level changes", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc", level: "error" });

    await logger.info("nope");
    logger.setLevel("debug");
    await logger.info("yes");

    expect(records).toHaveLength(1);
    expect(records[0]!.msg).toBe("yes");
  });
});
