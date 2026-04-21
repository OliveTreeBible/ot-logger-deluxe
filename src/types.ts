/**
 * Public type definitions for ot-logger-deluxe.
 *
 * All consumers should import types from the package root:
 *   import type { LoggerOptions, LogOptions, SlackOptions } from "ot-logger-deluxe";
 */

/**
 * Log severity levels, ordered from lowest to highest.
 * "silent" disables all log output.
 */
export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "silent";

/**
 * Numeric priority for each level. Matches pino's scheme.
 * Higher numbers are more severe.
 */
export const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity,
};

/** Levels that can be routed to Slack (everything except trace/debug/silent). */
export type SlackableLevel = "info" | "warn" | "error" | "fatal";

/**
 * A single structured field attached to a log record.
 * Values are coerced safely for both JSON and Slack rendering:
 *   - `Date`            -> ISO 8601 string
 *   - `Error`           -> { name, message, stack } (JSON) / formatted text (Slack)
 *   - primitives        -> `String(value)`
 *   - objects / arrays  -> `JSON.stringify(value)` with size caps
 */
export interface Field {
  /** The value to render. Accepts any coercible type. */
  value: unknown;
  /** Render the value inside Slack inline code (`backticks`). */
  code?: boolean;
}

/** A map of field name -> value (or { value, code }). */
export type FieldMap = Record<string, unknown | Field>;

/**
 * Per-call options for any log method (info / warn / error / etc).
 */
export interface LogOptions {
  /**
   * Structured fields to include alongside the message.
   * Each value may be a raw value or a `Field` object.
   */
  fields?: FieldMap;

  /** Attach an Error. Serialized to { name, message, stack } in JSON and shown as a "Stack" field in Slack. */
  error?: unknown;

  /** Render a large block of code / stack / SQL / etc as a Slack `mrkdwn` code block. */
  code?: string | boolean;

  /**
   * Post to Slack.
   *   - `false` (default for trace/debug) -> never post
   *   - `true` -> post using the resolved webhook/channel for this level
   *   - `{ channel?, mention? }` -> explicit overrides
   *
   * If Slack isn't configured, any truthy value is a silent no-op.
   */
  slack?: boolean | SlackPostOptions;
}

/** Explicit per-message Slack routing/formatting overrides. */
export interface SlackPostOptions {
  /**
   * Override the destination. For webhooks, this is a URL or a key in
   * `slack.channels`. For the Web API, this is a channel id/name.
   */
  channel?: string;

  /** Extra mention (e.g. "@channel", "@here", "<!subteam^ABC123>") to append to the message. */
  mention?: string;
}

/**
 * Top-level logger configuration. Everything is optional; defaults are sane.
 */
export interface LoggerOptions {
  /** Logger name (ends up as the `name` field on every record). Required. */
  name: string;

  /** Minimum level to emit. Default: "info". */
  level?: LogLevel;

  /** Hostname override (default: `os.hostname()`). Appears in JSON + Slack context. */
  hostname?: string;

  /**
   * Enable colorized, human-readable output via pino-pretty.
   * Default: `false`. Consider `process.env.NODE_ENV !== "production"` in dev.
   *
   * Note: `pino-pretty` is loaded lazily and listed as an optional dependency.
   */
  pretty?: boolean;

  /** Optional Slack configuration. Omit to disable Slack entirely. */
  slack?: SlackOptions;

  /** Additional pino transport destinations (files, syslog, custom). */
  transports?: TransportOptions;

  /**
   * Bindings merged into every log record from this logger. Useful for
   * process-wide context (serviceVersion, deploymentEnv, ...).
   */
  bindings?: Record<string, unknown>;
}

/** Slack integration configuration. */
export interface SlackOptions {
  /**
   * Fallback Incoming Webhook URL used for any level that doesn't have a
   * more specific route. Omit to require per-level routes (or disable Slack).
   */
  defaultWebhookUrl?: string;

  /** Per-level Incoming Webhook URL overrides. */
  channels?: Partial<Record<SlackableLevel, string>>;

  /**
   * Mentions appended to the Slack message for each level.
   * Values are raw mrkdwn, e.g. "@channel", "@here", "<!subteam^ABC123>".
   */
  mention?: Partial<Record<SlackableLevel, string>>;

  /**
   * Hostname shown in the Slack context block. Falls back to the logger's
   * `hostname`, then `os.hostname()`.
   */
  hostname?: string;

  /**
   * Enable the Slack Web API transport (bot token). When set, messages are
   * delivered via `chat.postMessage` instead of (or in addition to) webhooks.
   *
   * Requires `@slack/web-api` to be installed (declared as an optional peer dependency).
   */
  webApi?: SlackWebApiOptions;

  /**
   * HTTP retry tuning for the webhook transport.
   *   - `attempts`    max send attempts (default 3)
   *   - `baseDelayMs` first retry delay; doubled each attempt (default 250)
   *   - `timeoutMs`   per-request timeout (default 5000)
   */
  retry?: SlackRetryOptions;
}

/** Slack Web API (bot token) options. */
export interface SlackWebApiOptions {
  /** Bot token (`xoxb-...`). */
  token: string;
  /** Default channel id/name. Applies when a level-specific channel isn't set. */
  defaultChannel?: string;
  /** Per-level channel overrides. */
  channels?: Partial<Record<SlackableLevel, string>>;
}

/** Retry/timeout tuning for Slack webhook calls. */
export interface SlackRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

/** Additional pino transport destinations. */
export interface TransportOptions {
  /** Append JSON records to one or more files (uses pino's `pino/file` transport). */
  files?: string[];

  /**
   * Enable the RFC 3164/5424 syslog transport. Requires `pino-syslog` and
   * `pino-socket` (listed as optional dependencies).
   */
  syslog?: SyslogTransportOptions;

  /**
   * Escape hatch: pass raw pino transport targets through to
   * `pino.transport({ targets: [...] })`.
   */
  custom?: Array<Record<string, unknown>>;
}

/** Configuration for the opt-in RFC 3164/5424 syslog transport. */
export interface SyslogTransportOptions {
  /** Remote syslog host. */
  host: string;
  /** Remote syslog port. Default: 514. */
  port?: number;
  /** Transport protocol. Default: "udp". */
  protocol?: "udp" | "tcp" | "tls";
  /** `APP-NAME` field (RFC 5424). Defaults to the logger's `name`. */
  appName?: string;
  /** `pino-syslog` format. Default: "RFC5424". */
  format?: "RFC3164" | "RFC5424";
  /** syslog facility (0-23). Default: 16 (local0). */
  facility?: number;
  /** Include NDJSON payload as the syslog MSG. Default: true. */
  includeStructured?: boolean;
}
