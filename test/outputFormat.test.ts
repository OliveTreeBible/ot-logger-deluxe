import { describe, expect, it } from "vitest";

import { createCapturingLogger } from "./helpers/captureLogger.js";

/**
 * Guards against regressions that would break stdout-based log shippers
 * (CloudWatch agent, Docker awslogs, journald, PM2, etc).
 */
describe("log output format", () => {
  it("emits one JSON record per log call", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });

    await logger.info("a");
    await logger.warn("b");
    await logger.error("c");

    expect(records).toHaveLength(3);
    expect(records.map((r) => r.msg)).toEqual(["a", "b", "c"]);
  });

  it("every record parses as JSON and has the required top-level keys", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });

    await logger.info("ok", { fields: { requestId: "abc" } });

    const rec = records[0]!;
    // Required top-level fields for CloudWatch Insights auto-discovery
    expect(rec).toHaveProperty("time");
    expect(rec).toHaveProperty("level");
    expect(rec).toHaveProperty("levelLabel");
    expect(rec).toHaveProperty("name");
    expect(rec).toHaveProperty("hostname");
    expect(rec).toHaveProperty("pid");
    expect(rec).toHaveProperty("msg");
    expect(rec).toHaveProperty("requestId");
  });

  it("encodes structured values so JSON.parse roundtrips cleanly", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });

    await logger.info("complex", {
      fields: {
        nested: { a: 1, b: [true, null, "x"] },
        list: [1, 2, 3],
        quoted: 'he said "hi"',
      },
    });

    const rec = records[0]!;
    expect(rec.nested).toEqual({ a: 1, b: [true, null, "x"] });
    expect(rec.list).toEqual([1, 2, 3]);
    expect(rec.quoted).toBe('he said "hi"');
  });
});
