import type { Field, FieldMap } from "../types.js";

/** Normalized field: always has `{ value: string, code: boolean }` for rendering. */
export interface NormalizedField {
  name: string;
  value: string;
  code: boolean;
  /** Raw (pre-stringification) value for JSON logging. */
  raw: unknown;
}

const MAX_JSON_LENGTH = 8_000;

/** Coerce any value to a safe string representation for display. */
export function stringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    const parts = [`${value.name}: ${value.message}`];
    if (value.stack) parts.push(value.stack);
    return parts.join("\n");
  }
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return String(value);
    return json.length > MAX_JSON_LENGTH ? json.slice(0, MAX_JSON_LENGTH) + "..." : json;
  } catch {
    return String(value);
  }
}

/** Serialize an Error for structured logging (pino-friendly shape). */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      type: err.name,
      message: err.message,
    };
    if (err.stack) out.stack = err.stack;
    if ("cause" in err && err.cause !== undefined) out.cause = serializeError(err.cause);
    for (const key of Object.keys(err)) {
      if (!(key in out)) {
        out[key] = (err as unknown as Record<string, unknown>)[key];
      }
    }
    return out;
  }
  if (typeof err === "object" && err !== null) {
    return { ...(err as Record<string, unknown>) };
  }
  return { message: stringify(err) };
}

const FIELD_ALLOWED_KEYS = new Set(["value", "code"]);

/**
 * Strict detection for the `Field` wrapper shape: `{ value, code? }` with no
 * other own enumerable keys. Requiring a subset of `{ value, code }` prevents
 * us from silently swallowing real payloads like `{ value: 1, unit: "ms" }`,
 * which would otherwise be misinterpreted as a Field and logged as just `1`.
 */
export function isField(value: unknown): value is Field {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  if (!Object.prototype.hasOwnProperty.call(value, "value")) return false;
  for (const key of Object.keys(value as object)) {
    if (!FIELD_ALLOWED_KEYS.has(key)) return false;
  }
  return true;
}

/**
 * Prepare a raw field value for JSON logging. Error instances are expanded
 * into `{ type, message, stack, ... }` here because otherwise pino receives
 * them as opaque objects and `JSON.stringify` drops the (non-enumerable)
 * Error properties, yielding `{}` in the output.
 */
function coerceRaw(value: unknown): unknown {
  if (value instanceof Error) return serializeError(value);
  return value;
}

/**
 * Normalize a FieldMap into an ordered array of NormalizedFields.
 * `defaultCode` applies the `code` flag to every entry that doesn't override it.
 */
export function normalizeFields(fields: FieldMap | undefined, defaultCode = false): NormalizedField[] {
  if (!fields) return [];
  const result: NormalizedField[] = [];
  for (const [name, input] of Object.entries(fields)) {
    if (isField(input)) {
      result.push({
        name,
        raw: coerceRaw(input.value),
        value: stringify(input.value),
        code: input.code ?? defaultCode,
      });
    } else {
      result.push({
        name,
        raw: coerceRaw(input),
        value: stringify(input),
        code: defaultCode,
      });
    }
  }
  return result;
}

/** Build a plain record suitable for pino's structured output. */
export function fieldsToRecord(fields: NormalizedField[]): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  for (const f of fields) {
    rec[f.name] = f.raw;
  }
  return rec;
}
