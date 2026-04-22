import { describe, expect, it } from "vitest";

import { isField, normalizeFields } from "../src/internal/coerce.js";

describe("isField (strict wrapper detection)", () => {
  it("accepts { value }", () => {
    expect(isField({ value: 1 })).toBe(true);
  });

  it("accepts { value, code }", () => {
    expect(isField({ value: "x", code: true })).toBe(true);
  });

  it("rejects objects that carry extra keys (prevents silent data loss)", () => {
    // This is the regression case: a user payload like { value: 1, unit: "ms" }
    // must be treated as a raw nested object, not as a Field with value=1.
    expect(isField({ value: 1, unit: "ms" })).toBe(false);
  });

  it("rejects objects without a `value` key", () => {
    expect(isField({ code: true })).toBe(false);
    expect(isField({})).toBe(false);
  });

  it("rejects arrays, null, primitives, and Errors", () => {
    expect(isField(null)).toBe(false);
    expect(isField(undefined)).toBe(false);
    expect(isField([1, 2, 3])).toBe(false);
    expect(isField("value")).toBe(false);
    expect(isField(42)).toBe(false);
    expect(isField(new Error("boom"))).toBe(false);
  });
});

describe("normalizeFields with stricter isField", () => {
  it("preserves extra keys on plain objects by stringifying the whole thing", () => {
    const result = normalizeFields({ metric: { value: 1, unit: "ms" } });
    expect(result).toHaveLength(1);
    const parsed = JSON.parse(result[0]!.value);
    expect(parsed).toEqual({ value: 1, unit: "ms" });
  });

  it("unwraps strict Field wrappers to just the value", () => {
    const result = normalizeFields({ latency: { value: 42, code: true } });
    expect(result).toHaveLength(1);
    expect(result[0]!.raw).toBe(42);
    expect(result[0]!.code).toBe(true);
  });

  it("expands plain-field Error values so JSON.stringify doesn't drop their properties", () => {
    // Regression: Error props (name/message/stack) are non-enumerable, so
    // passing a raw Error through pino would otherwise serialize to {}.
    const err = new TypeError("boom");
    const result = normalizeFields({ cause: err });
    expect(result).toHaveLength(1);

    const raw = result[0]!.raw as Record<string, unknown>;
    expect(raw.type).toBe("TypeError");
    expect(raw.message).toBe("boom");
    expect(typeof raw.stack).toBe("string");

    // And crucially, it survives JSON.stringify now.
    const roundtrip = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    expect(roundtrip.type).toBe("TypeError");
    expect(roundtrip.message).toBe("boom");
  });

  it("also expands Error values nested inside Field wrappers", () => {
    const err = new Error("wrapped");
    const result = normalizeFields({ cause: { value: err, code: false } });
    const raw = result[0]!.raw as Record<string, unknown>;
    expect(raw.type).toBe("Error");
    expect(raw.message).toBe("wrapped");
  });
});
