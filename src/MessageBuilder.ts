import type { Logger } from "./Logger.js";
import { isField } from "./internal/coerce.js";
import type { Field, FieldMap, LogLevel, LogOptions, SlackPostOptions } from "./types.js";

/**
 * Fluent builder for composing log calls. Returned by `Logger.message(...)`.
 *
 * ```ts
 * await log.message("Program group is inactive.")
 *   .level("warn")
 *   .fields({ action_id: 1, group_id: 2 }, { code: true })
 *   .toSlack()
 *   .send();
 * ```
 */
export class MessageBuilder {
  private readonly logger: Logger;
  private readonly msg: string;
  private _level: LogLevel = "info";
  private readonly _fields: Record<string, Field> = {};
  private _error?: unknown;
  private _code?: string;
  private _slack: boolean | SlackPostOptions = false;

  /** @internal use `logger.message(...)` */
  constructor(logger: Logger, message: string) {
    this.logger = logger;
    this.msg = message;
  }

  /** Set the log level (default "info"). */
  level(level: LogLevel): this {
    this._level = level;
    return this;
  }

  /** Add a single field. */
  field(name: string, value: unknown, opts: { code?: boolean } = {}): this {
    this._fields[name] = { value, code: opts.code };
    return this;
  }

  /** Add many fields. `opts.code` applies to every field that doesn't override it. */
  fields(map: FieldMap, opts: { code?: boolean } = {}): this {
    for (const [name, input] of Object.entries(map)) {
      if (isField(input)) {
        this._fields[name] = {
          value: input.value,
          code: input.code ?? opts.code,
        };
      } else {
        this._fields[name] = { value: input, code: opts.code };
      }
    }
    return this;
  }

  /** Attach an Error. */
  error(err: unknown): this {
    this._error = err;
    return this;
  }

  /** Attach a code block (stack trace, SQL, JSON payload, etc). */
  code(block: string): this {
    this._code = block;
    return this;
  }

  /** Route to Slack. Optionally pass per-message overrides. */
  toSlack(opts?: SlackPostOptions): this {
    this._slack = opts ?? true;
    return this;
  }

  /** Emit the log and, if configured, post to Slack. */
  async send(): Promise<void> {
    const options: LogOptions = {
      fields: this._fields,
      slack: this._slack,
    };
    if (this._error !== undefined) options.error = this._error;
    if (this._code !== undefined) options.code = this._code;
    await this.logger.log(this._level, this.msg, options);
  }
}
