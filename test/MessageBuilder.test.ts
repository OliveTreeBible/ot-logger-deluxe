import { describe, expect, it } from "vitest";

import { createCapturingLogger } from "./helpers/captureLogger.js";

describe("MessageBuilder", () => {
  it("produces the same record as the options-object form", async () => {
    const { logger: direct, records: directRecs } = createCapturingLogger({ name: "svc" });
    const { logger: fluent, records: fluentRecs } = createCapturingLogger({ name: "svc" });

    await direct.warn("Program group is inactive.", {
      fields: {
        action_id: 1,
        group_id: 2,
        group_name: "beta",
      },
    });

    await fluent
      .message("Program group is inactive.")
      .level("warn")
      .fields({ action_id: 1, group_id: 2, group_name: "beta" })
      .send();

    const normalize = (r: Record<string, unknown>) => {
      const { time: _time, ...rest } = r;
      return rest;
    };
    expect(directRecs.map(normalize)).toEqual(fluentRecs.map(normalize));
  });

  it("supports per-field code flags", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });

    await logger
      .message("msg")
      .level("info")
      .field("tag", "hot", { code: true })
      .field("plain", "cold")
      .send();

    expect(records[0]).toMatchObject({ tag: "hot", plain: "cold" });
  });

  it("attaches errors via .error()", async () => {
    const { logger, records } = createCapturingLogger({ name: "svc" });
    const err = new TypeError("bad");

    await logger.message("broken").level("error").error(err).send();

    expect(records[0]!.err).toMatchObject({ type: "TypeError", message: "bad" });
  });
});
