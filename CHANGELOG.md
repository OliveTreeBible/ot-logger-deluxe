# Changelog

## 2.0.0 — 2026-04-21

**Breaking rewrite.** The entire public API has been replaced. See
[README.md](./README.md#migrating-from-v1x) for a migration table.

### Added

- `createLogger(options)` — primary factory with a simple options object.
- `createLoggerFromEnv(overrides?)` — zero-config factory that reads
  `LOG_LEVEL`, `SLACK_WEBHOOK_URL`, `SLACK_WEBHOOK_URL_<LEVEL>`,
  `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_<LEVEL>`, `LOG_SYSLOG_HOST`, `LOG_FILE`,
  and more.
- `Logger.message(...)` fluent builder for composing complex log calls.
- `Logger.child(bindings)` for contextual child loggers.
- Slack Web API transport (`slack.webApi.token`) as an opt-in alternative or
  addition to Incoming Webhooks. Requires `@slack/web-api` (optional peer dep).
- Slack Block Kit messages are now built with typed `KnownBlock[]` objects
  and serialized via `JSON.stringify`, eliminating the string-templating
  escape bugs in v1.
- Slack webhook calls now retry up to 3 times with exponential backoff,
  honoring `Retry-After` on 429, with a per-attempt 5s timeout. Failures are
  routed to the logger itself at `warn` level with `slackError: true`.
- Graceful Slack fallback: any unconfigured level silently skips Slack.
- RFC 5424 syslog transport (`transports.syslog`, requires optional
  `pino-syslog` and `pino-socket`).
- File transports (`transports.files`) and arbitrary custom pino transports
  (`transports.custom`).
- Dual ESM + CJS build with proper `exports` map and type declarations.
- Vitest-based test suite covering Logger, MessageBuilder, BlockKitBuilder,
  WebhookClient retries, SlackTransport routing, env factory, and output
  format.

### Changed

- **Output format**: newline-delimited JSON with ISO 8601 timestamps,
  suitable for CloudWatch Logs Insights auto-field-parsing, Docker `awslogs`,
  journald, PM2, etc. Pretty output is opt-in (`pretty: true`) and loads
  `pino-pretty` lazily.
- `@types/node` moved from `dependencies` to `devDependencies`.
- Node 20+ required (`engines.node >= 20`).

### Removed

- `moment` dependency (replaced by `pino.stdTimeFunctions.isoTime`).
- `superagent` dependency (replaced by native `fetch`).
- `typescript-logging` and `typescript-logging-log4ts-style` dependencies
  (replaced by `pino`).
- `OTLoggerDeluxe` class. Use `createLogger`.
- `OTLogableMessage` and `IOTMessagePart`. Use the `fields` option.
- `SlackAlertType` enum, `ISlackConfig`/`ISlackKeys` interfaces, and
  `OTSlackWebhook` class. Use the new `SlackOptions` / `SlackTransport`.
- Re-export of `LogLevel` from `typescript-logging`. A local string-union
  `LogLevel` type replaces it.

### Fixed

- Slack message bodies no longer break when the text contains newlines,
  unescaped quotes, backslashes, emoji, or angle brackets.
