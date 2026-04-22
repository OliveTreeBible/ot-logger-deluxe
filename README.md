# ot-logger-deluxe

Ergonomic structured JSON logging for Node.js with an optional, hardened Slack
transport. Built on [pino](https://getpino.io) and
[Slack Block Kit](https://api.slack.com/block-kit).

- Easy by default: `createLogger({ name: "my-app" })` and call `log.info("hello")`.
- Structured: every line is JSON with ISO 8601 timestamps. CloudWatch Logs
  Insights, Datadog, journald, Docker `awslogs` all parse fields automatically.
- Slack is optional and graceful. Partial config is fine. Failing webhooks never
  crash your app or block your request.
- Two APIs: an options-object form for quick calls, a fluent builder for complex
  messages.
- TypeScript first. Dual ESM + CJS. Node 20+.

## Install

```bash
npm install ot-logger-deluxe
```

Optional add-ons:

```bash
# Slack Web API (chat.postMessage via bot token)
npm install @slack/web-api

# Pretty console output in dev (also installed automatically as an optional dep)
npm install pino-pretty

# Forward to a remote syslog daemon
npm install pino-syslog pino-socket
```

## Quickstart

```ts
import { createLogger } from "ot-logger-deluxe";

const log = createLogger({
  name: "my-service",
  level: "info",
  pretty: process.env.NODE_ENV !== "production",
});

log.info("server started", { fields: { port: 3000 } });
log.warn("slow request", { fields: { durationMs: 2456, path: "/api/things" } });
log.error("db query failed", { error: err, code: "select * from users where ..." });
```

Output (production):

```json
{"level":30,"levelLabel":"info","time":"2026-04-21T15:30:00.123Z","name":"my-service","hostname":"web-1","pid":42,"port":3000,"msg":"server started"}
```

## Detailed logs

Everything beyond a one-liner goes through the optional second argument.

```ts
await log.warn("Program group is inactive.", {
  fields: {
    action_id: action.id,
    action: action.action,
    action_time: thisActionTime,
    group_id: group.id,
    group_name: group.name,
  },
  code: true, // render every field's value as Slack inline `code`
  slack: true,
});
```

Each field value is coerced safely:

| Value type | JSON output | Slack output |
| --- | --- | --- |
| `string`, `number`, `boolean` | as-is | `String(value)` |
| `Date` | ISO 8601 string | ISO 8601 string |
| `Error` | `{ type, message, stack, cause }` | `*Stack:*` code block |
| Array / object | nested JSON | `JSON.stringify(...)`, capped |

Per-field overrides (mix and match):

```ts
log.info("cache hit", {
  fields: {
    key: { value: cacheKey, code: true },
    latency_ms: 4,
    stale: false,
  },
});
```

## Fluent builder

Equivalent to the options form, useful when composing across branches:

```ts
await log
  .message("Program group is inactive.")
  .level("warn")
  .fields({
    action_id: action.id,
    action: action.action,
    action_time: thisActionTime,
    group_id: group.id,
    group_name: group.name,
  }, { code: true })
  .toSlack()
  .send();
```

## Child loggers

Merge context into every record from a derived logger. Slack config is shared.

```ts
const req = log.child({ requestId, userId });
req.info("handled");         // includes requestId + userId automatically
req.warn("rate limited");
```

## Slack integration

### Option A: Incoming Webhooks (simplest, recommended)

1. Create one or more Incoming Webhook URLs at
   [api.slack.com/apps](https://api.slack.com/apps).
2. Pass the URLs when constructing the logger:

```ts
const log = createLogger({
  name: "billing",
  slack: {
    defaultWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    channels: {
      error: process.env.SLACK_WEBHOOK_URL_ERROR,
      fatal: process.env.SLACK_WEBHOOK_URL_FATAL,
    },
    mention: { fatal: "@channel", error: "@here" },
  },
});

await log.error("payment failed", { error: err, slack: true });
```

**Fallback rules (silent skip by design):**

- Level-specific URL → used if set.
- Otherwise `defaultWebhookUrl` → used if set.
- Otherwise Slack is skipped silently for that level. `slack: true` never
  throws.

### Option B: Slack Web API (bot token)

Requires `@slack/web-api` (declared as an optional peer dependency):

```ts
const log = createLogger({
  name: "billing",
  slack: {
    webApi: {
      token: process.env.SLACK_BOT_TOKEN!,
      defaultChannel: "#alerts",
      channels: { fatal: "#alerts-critical" },
    },
  },
});
```

You can combine Web API and webhooks; both will be dispatched.

### Retries, timeouts, failures

Webhook calls retry up to 3 times with exponential backoff, honoring Slack's
`Retry-After` header on 429. Each attempt has a 5s timeout. On final failure
the error is surfaced **through the logger itself** at `warn` level with
`slackError: true` metadata — it never propagates back to your code.

```ts
slack: {
  defaultWebhookUrl: "...",
  retry: { attempts: 3, baseDelayMs: 250, timeoutMs: 5000 },
}
```

### Delivery model (fire-and-forget)

`log.<level>(..., { slack: true })` returns to the caller as soon as the
pino record has been written locally. The Slack send runs in the background
so your request isn't blocked by retries, timeouts, or `Retry-After` delays
(which can add up to tens of seconds in the worst case).

If you need to guarantee Slack delivery before the process exits (graceful
shutdown, tests, CLIs), call `await logger.flush()` — it drains every
in-flight Slack send and then flushes pino's transports:

```ts
process.on("SIGTERM", async () => {
  await log.fatal("shutting down", { slack: true });
  await log.flush(); // waits for Slack + pino
  process.exit(0);
});
```

### Per-message overrides

```ts
await log.error("scoped alert", {
  slack: { channel: "https://hooks.slack.com/services/override/...", mention: "@here" },
});
```

## Zero-config via environment

```ts
import { createLoggerFromEnv } from "ot-logger-deluxe";

const log = createLoggerFromEnv({ name: "my-service" });
```

Recognized variables:

| Variable | Purpose |
| --- | --- |
| `LOG_LEVEL` | `trace`, `debug`, `info` (default), `warn`, `error`, `fatal`, `silent` |
| `LOG_NAME` | Logger name (falls back to overrides or `"app"`) |
| `LOG_PRETTY` | `1`/`true` to enable `pino-pretty` colorized output |
| `LOG_FILE` | Append JSON records to this file (in addition to stdout) |
| `LOG_SYSLOG_HOST` | Enable RFC 5424 syslog transport |
| `LOG_SYSLOG_PORT` | Default `514` (or `6514` when `LOG_SYSLOG_PROTOCOL=tls`) |
| `LOG_SYSLOG_PROTOCOL` | `udp` (default), `tcp`, or `tls` (RFC 5425) |
| `LOG_SYSLOG_REJECT_UNAUTHORIZED` | `0`/`false` to accept self-signed TLS certs |
| `LOG_SYSLOG_APP_NAME` | `APP-NAME` field (defaults to logger name) |
| `SLACK_WEBHOOK_URL` | Fallback Incoming Webhook for all levels |
| `SLACK_WEBHOOK_URL_INFO` | Per-level webhooks |
| `SLACK_WEBHOOK_URL_WARN` | |
| `SLACK_WEBHOOK_URL_ERROR` | |
| `SLACK_WEBHOOK_URL_FATAL` | |
| `SLACK_MENTION_WARN` | Raw mrkdwn (`@here`, `@channel`, `<!subteam^ID>`) |
| `SLACK_MENTION_ERROR` | |
| `SLACK_MENTION_FATAL` | |
| `SLACK_BOT_TOKEN` | Enable Slack Web API transport (`xoxb-...`) |
| `SLACK_CHANNEL` | Default Web API channel id/name |
| `SLACK_CHANNEL_INFO` | Per-level Web API channels |
| `SLACK_CHANNEL_WARN` | |
| `SLACK_CHANNEL_ERROR` | |
| `SLACK_CHANNEL_FATAL` | |

Explicit overrides passed to `createLoggerFromEnv({...})` always win.

## Log output format

The default transport writes **newline-delimited JSON** to stdout. Each record
contains:

| Field | Description |
| --- | --- |
| `time` | ISO 8601 / RFC 3339 timestamp (`"2026-04-21T15:30:00.123Z"`) |
| `level` | Numeric pino level (`30` = info, `50` = error, ...) |
| `levelLabel` | Human-readable level (`"info"`, `"error"`, ...) |
| `name` | Logger name |
| `hostname` | `os.hostname()` or the configured override |
| `pid` | Process id |
| `msg` | Message string |
| `...` | Your structured fields (spread into the top-level object) |
| `err` | Present when you pass `{ error }`; `{ type, message, stack, ... }` |
| `code` | Present when you pass `{ code: "..." }` |

### CloudWatch / Docker / ECS / EKS / journald / PM2

Works out of the box. Each log shipper tails stdout and forwards JSON lines
unchanged. In CloudWatch Logs Insights you can query fields directly:

```
fields @timestamp, levelLabel, msg, requestId
| filter level >= 50
| filter requestId = "abc"
```

### Pretty output for local dev

```ts
createLogger({ name: "svc", pretty: true });
```

`pino-pretty` is loaded lazily and listed as an optional dependency, so
production installs stay lean. Always disable `pretty` in production.

### Remote syslog (opt-in)

For rsyslog / syslog-ng / Papertrail users who need strict RFC 5424 wire
format. Requires `pino-syslog` and `pino-socket`.

```ts
// Plain UDP (RFC 5424)
createLogger({
  name: "svc",
  transports: {
    syslog: { host: "logs.example.com", port: 514, protocol: "udp", format: "RFC5424" },
  },
});

// TLS (RFC 5425 syslog over TLS/TCP) - certs verified by default
createLogger({
  name: "svc",
  transports: {
    syslog: {
      host: "logs.papertrailapp.com",
      port: 6514,
      protocol: "tls",
      // rejectUnauthorized: false,  // uncomment only for self-signed test setups
    },
  },
});
```

### Tee to files or custom destinations

```ts
createLogger({
  name: "svc",
  transports: {
    files: ["/var/log/svc.log"],
    custom: [{ target: "pino-loki", options: { host: "https://loki.example.com" } }],
  },
});
```

## Level reference

| Level | Numeric | Typical use |
| --- | --- | --- |
| `trace` | 10 | Very noisy, usually off |
| `debug` | 20 | Development diagnostics |
| `info` | 30 | Normal operation |
| `warn` | 40 | Concerning but recoverable |
| `error` | 50 | Unrecoverable request failure |
| `fatal` | 60 | Process-ending condition |
| `silent` | ∞ | Disable all output |

Only `info`, `warn`, `error`, and `fatal` can route to Slack. `trace` and
`debug` ignore the `slack` option.

## Migrating from v1.x

v2.0 is a clean rewrite and replaces the entire public API. The shape of your
code changes, but the *intent* carries over cleanly.

| v1.x | v2.x |
| --- | --- |
| `new OTLoggerDeluxe(opts, name, slackConfig)` | `createLogger({ name, level, slack })` |
| `OTLoggerDeluxeOptions.providerName` / `logGroupingPattern` | removed (pino handles grouping) |
| `logInfo`, `logWarning`, `logError`, `logFatal`, `logDebug`, `logTrace` | `log.info`, `log.warn`, `log.error`, `log.fatal`, `log.debug`, `log.trace` |
| `logErrorWithErrorPart(msg, err)` | `log.error(msg, { error: err })` |
| `OTLogableMessage` + `IOTMessagePart[]` | `{ fields: { name: value, name: { value, code: true } } }` |
| `ISlackConfig.keys.<level>ChannelKey` (path after `/services/`) | `slack.channels.<level>` (full URL) |
| `SlackAlertType` enum | removed |
| Re-export of `LogLevel` from `typescript-logging` | local string union type |

`moment`, `superagent`, `typescript-logging`, and
`typescript-logging-log4ts-style` are no longer required. `@types/node` is now
a dev-only dependency.

See [`CHANGELOG.md`](./CHANGELOG.md) for the full breaking-change list.

## License

MIT © David Trotz
