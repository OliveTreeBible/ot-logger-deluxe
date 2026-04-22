import os from "node:os";
import {
  pino,
  stdTimeFunctions,
  transport as pinoTransport,
  type Logger as PinoLogger,
  type TransportTargetOptions,
} from "pino";

import { MessageBuilder } from "./MessageBuilder.js";
import { fieldsToRecord, normalizeFields } from "./internal/coerce.js";
import { SlackTransport } from "./slack/SlackTransport.js";
import type {
  LogLevel,
  LogOptions,
  LoggerOptions,
  SlackableLevel,
  TransportOptions,
} from "./types.js";

const SLACKABLE_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>([
  "info",
  "warn",
  "error",
  "fatal",
]);

/**
 * Ergonomic, structured logger with an optional Slack transport.
 * Create instances with `createLogger()` rather than invoking the constructor directly.
 */
export class Logger {
  private readonly pino: PinoLogger;
  private readonly slack?: SlackTransport;
  private readonly hostname: string;
  private readonly name: string;

  /** @internal use `createLogger()` instead */
  constructor(
    options: LoggerOptions,
    pinoInstance?: PinoLogger,
    slackTransport?: SlackTransport
  ) {
    this.name = options.name;
    this.hostname = options.hostname ?? os.hostname();
    this.pino = pinoInstance ?? Logger.createPino(options, this.hostname);
    this.slack =
      slackTransport !== undefined
        ? slackTransport
        : options.slack
          ? new SlackTransport(options.slack, {
              hostname: options.slack.hostname ?? this.hostname,
              loggerName: this.name,
              onTransportError: (meta) =>
                this.pino.warn({ slackError: true, ...meta }, "Slack transport error"),
            })
          : undefined;
  }

  /**
   * Return a child logger with additional bindings merged into every record.
   * The Slack transport is shared with the parent.
   */
  child(bindings: Record<string, unknown>): Logger {
    // Go through the real constructor rather than Object.create to preserve
    // invariants. We pass the already-built pino child and the parent's
    // SlackTransport directly so the constructor won't rebuild either.
    return new Logger(
      { name: this.name, hostname: this.hostname, level: this.level },
      this.pino.child(bindings),
      this.slack
    );
  }

  /** Current log level (e.g. "info"). */
  get level(): LogLevel {
    return this.pino.level as LogLevel;
  }

  /** Change the log level at runtime. */
  setLevel(level: LogLevel): void {
    this.pino.level = level;
  }

  /** Begin composing a log via the fluent builder. */
  message(message: string): MessageBuilder {
    return new MessageBuilder(this, message);
  }

  trace(msg: string, opts?: LogOptions): Promise<void> {
    return this.log("trace", msg, opts);
  }
  debug(msg: string, opts?: LogOptions): Promise<void> {
    return this.log("debug", msg, opts);
  }
  info(msg: string, opts?: LogOptions): Promise<void> {
    return this.log("info", msg, opts);
  }
  warn(msg: string, opts?: LogOptions): Promise<void> {
    return this.log("warn", msg, opts);
  }
  error(msg: string, opts?: LogOptions): Promise<void> {
    return this.log("error", msg, opts);
  }
  fatal(msg: string, opts?: LogOptions): Promise<void> {
    return this.log("fatal", msg, opts);
  }

  /**
   * Wait for every in-flight Slack send to settle, then flush pino's
   * buffered transports. Call this at graceful shutdown (or in tests) when
   * you need to know that fire-and-forget Slack deliveries have completed.
   */
  async flush(): Promise<void> {
    if (this.slack) {
      await this.slack.drained();
    }
    const flushFn = this.pino.flush;
    if (typeof flushFn !== "function") return;
    await new Promise<void>((resolve) => {
      try {
        flushFn.call(this.pino, () => resolve());
      } catch {
        // Defensive: if flush throws (e.g. transport already ended), don't hang.
        resolve();
      }
    });
  }

  /**
   * Core logging entry. Public for `MessageBuilder.send()`; prefer the level
   * shorthands (`log.info(...)`) in application code.
   *
   * @internal
   */
  async log(level: LogLevel, msg: string, opts: LogOptions = {}): Promise<void> {
    if (level === "silent") return;

    // `code: true` is a shorthand for "wrap every field value in inline code"
    // on the Slack side; a string value becomes a fenced code block instead.
    const defaultFieldCode = opts.code === true;
    const fields = normalizeFields(opts.fields, defaultFieldCode);
    const record: Record<string, unknown> = { ...fieldsToRecord(fields) };

    if (opts.error !== undefined) {
      // Pass through raw Error; pino's built-in `err` serializer will produce
      // { type, message, stack, ... } for us.
      record.err = opts.error;
    }
    if (typeof opts.code === "string" && opts.code.length > 0) {
      record.code = opts.code;
    }

    // Direct property-access call keeps `this` correct without allocating a
    // new bound function on every log (this is on the hot path).
    if (Object.keys(record).length > 0) {
      this.pino[level](record, msg);
    } else {
      this.pino[level](msg);
    }

    if (!this.slack || !SLACKABLE_LEVELS.has(level) || !opts.slack) return;

    const slackableLevel = level as SlackableLevel;
    const post = opts.slack === true ? undefined : opts.slack;

    // Fire-and-forget: SlackTransport tracks the send internally so
    // `logger.flush()` can await completion at shutdown. Awaiting here would
    // block the caller for up to the full retry budget on failures, which
    // would contradict the library's "Slack never blocks your request"
    // contract.
    void this.slack
      .post({
        level: slackableLevel,
        message: msg,
        fields,
        error: opts.error,
        code: typeof opts.code === "string" ? opts.code : undefined,
        channelOverride: post?.channel,
        mentionOverride: post?.mention,
      })
      .catch(() => {
        // SlackTransport already routes errors to pino.warn via
        // onTransportError; nothing to do here.
      });
  }

  /** @internal */
  static createPino(options: LoggerOptions, hostname: string): PinoLogger {
    const level = options.level ?? "info";
    const bindings = { name: options.name, ...(options.bindings ?? {}) };

    const targets = buildTransportTargets(options);

    const baseConfig = {
      level,
      base: { ...bindings, hostname, pid: process.pid },
      timestamp: stdTimeFunctions.isoTime,
      formatters: {
        level(label: string, num: number) {
          return { level: num, levelLabel: label };
        },
      },
    };

    if (targets.length === 0) {
      return pino(baseConfig);
    }

    const stream = pinoTransport({ targets });
    return pino(baseConfig, stream);
  }
}

/**
 * Builds the list of pino transport targets for a given set of options.
 * Exported for testing; prefer `createLogger()` in application code.
 * @internal
 */
export function buildTransportTargets(options: LoggerOptions): TransportTargetOptions[] {
  const targets: TransportTargetOptions[] = [];
  const level = options.level ?? "info";

  if (options.pretty) {
    targets.push({
      target: "pino-pretty",
      level,
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        ignore: "pid,hostname",
        singleLine: false,
      },
    });
  } else {
    // Default: JSON to stdout. Only add this when we already have other
    // targets, otherwise pino will use its default stdout destination.
  }

  const transports = options.transports;
  if (transports) {
    addTransportDestinations(targets, transports, level, options.name);
  }

  if (targets.length > 0 && !options.pretty) {
    // If any non-pretty transport was added, we still need a stdout JSON target
    // so logs reach the console (CloudWatch, Docker awslogs, etc).
    const hasStdoutJson = targets.some(
      (t) => t.target === "pino/file" && (t.options as { destination?: number } | undefined)?.destination === 1
    );
    if (!hasStdoutJson) {
      targets.unshift({
        target: "pino/file",
        level,
        options: { destination: 1 },
      });
    }
  }

  return targets;
}

function addTransportDestinations(
  targets: TransportTargetOptions[],
  transports: TransportOptions,
  level: LogLevel,
  name: string
): void {
  if (transports.files) {
    for (const file of transports.files) {
      targets.push({
        target: "pino/file",
        level,
        options: { destination: file, mkdir: true },
      });
    }
  }

  if (transports.syslog) {
    const sys = transports.syslog;
    targets.push({
      target: "pino-syslog",
      level,
      options: {
        modern: (sys.format ?? "RFC5424") === "RFC5424",
        appname: sys.appName ?? name,
        facility: sys.facility ?? 16,
        includeProperties: sys.includeStructured ?? true,
      },
    });
    // `pino-syslog` transforms to syslog text; `pino-socket` delivers it.
    const protocol = sys.protocol ?? "udp";
    const socketOptions: Record<string, unknown> = {
      address: sys.host,
      port: sys.port ?? (protocol === "tls" ? 6514 : 514),
      mode: protocol === "udp" ? "udp" : "tcp",
    };
    if (protocol === "tls") {
      socketOptions.secure = true;
      // pino-socket's `noverify: true` disables TLS cert verification.
      // Our public option is `rejectUnauthorized` (Node's naming convention):
      // `rejectUnauthorized: false` -> `noverify: true`.
      if (sys.rejectUnauthorized === false) {
        socketOptions.noverify = true;
      }
      socketOptions.reconnect = true;
    } else if (protocol === "tcp") {
      socketOptions.reconnect = true;
    }
    targets.push({
      target: "pino-socket",
      level,
      options: socketOptions,
    });
  }

  if (transports.custom) {
    for (const target of transports.custom) {
      targets.push(target as unknown as TransportTargetOptions);
    }
  }
}

/** Primary factory. Always use this in application code. */
export function createLogger(options: LoggerOptions): Logger {
  return new Logger(options);
}
