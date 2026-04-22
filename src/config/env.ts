import { createLogger, type Logger } from "../Logger.js";
import type {
  LogLevel,
  LoggerOptions,
  SlackOptions,
  SlackableLevel,
  SyslogTransportOptions,
  TransportOptions,
} from "../types.js";

/**
 * Shape of the env-var source accepted by {@link createLoggerFromEnv}. This
 * is intentionally narrower than `NodeJS.ProcessEnv` so the API is portable
 * (no dependency on Node ambient types) and plain objects like
 * `{ LOG_LEVEL: "info" }` work with no casts under `strict: true`.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface CreateLoggerFromEnvOverrides extends Partial<LoggerOptions> {
  /**
   * Source of environment variables. Defaults to `process.env`.
   * Useful for tests or for loading from a `dotenv`-parsed object.
   */
  env?: EnvSource;

  /**
   * When true, every Slack-related env var (`SLACK_*`) is ignored and only
   * `overrides.slack` (if any) is honored. Use this to explicitly disable
   * Slack in environments whose process env happens to include Slack
   * configuration (e.g. staging, tests, CI).
   */
  ignoreEnvSlack?: boolean;

  /**
   * When true, transport-related env vars (`LOG_FILE`, `LOG_SYSLOG_*`) are
   * ignored and only `overrides.transports` (if any) is honored.
   */
  ignoreEnvTransports?: boolean;
}

const LEVEL_SUFFIXES: Record<SlackableLevel, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  fatal: "FATAL",
};

/**
 * Zero-config logger factory. Reads configuration from environment variables,
 * with optional explicit overrides.
 *
 * Recognized variables (all optional):
 *
 *   LOG_LEVEL                       trace|debug|info|warn|error|fatal|silent (default: info)
 *   LOG_NAME                        logger name (default: 'app' or overrides.name)
 *   LOG_PRETTY                      '1'/'true' -> enable pretty output
 *
 *   SLACK_WEBHOOK_URL               fallback webhook used when a level-specific one isn't set
 *   SLACK_WEBHOOK_URL_INFO          level-specific webhooks
 *   SLACK_WEBHOOK_URL_WARN
 *   SLACK_WEBHOOK_URL_ERROR
 *   SLACK_WEBHOOK_URL_FATAL
 *
 *   SLACK_MENTION_WARN              raw mrkdwn mention appended to Slack messages
 *   SLACK_MENTION_ERROR
 *   SLACK_MENTION_FATAL
 *
 *   SLACK_BOT_TOKEN                 enable Slack Web API transport (xoxb-...)
 *   SLACK_CHANNEL                   default Web API channel
 *   SLACK_CHANNEL_INFO              level-specific Web API channels
 *   SLACK_CHANNEL_WARN
 *   SLACK_CHANNEL_ERROR
 *   SLACK_CHANNEL_FATAL
 *
 *   LOG_SYSLOG_HOST                 enable RFC 5424 syslog transport
 *   LOG_SYSLOG_PORT                 default 514 (6514 when protocol=tls)
 *   LOG_SYSLOG_PROTOCOL             udp (default), tcp, or tls
 *                                   - tls = RFC 5425 syslog over TLS/TCP;
 *                                     certs are verified by default.
 *   LOG_SYSLOG_REJECT_UNAUTHORIZED  '0'/'false' to accept self-signed certs
 *                                   (TLS protocol only)
 *   LOG_SYSLOG_APP_NAME             APP-NAME (default: logger name)
 *
 *   LOG_FILE                        append JSON logs to this file
 */
export function createLoggerFromEnv(overrides: CreateLoggerFromEnvOverrides = {}): Logger {
  const env = overrides.env ?? process.env;

  const options: LoggerOptions = {
    name: overrides.name ?? env.LOG_NAME ?? "app",
    level: overrides.level ?? parseLevel(env.LOG_LEVEL) ?? "info",
    pretty: overrides.pretty ?? parseBool(env.LOG_PRETTY) ?? false,
    hostname: overrides.hostname,
    bindings: overrides.bindings,
  };

  // Slack: explicit override wins. Otherwise read from env, unless the
  // caller has opted out via `ignoreEnvSlack`.
  const slack =
    overrides.slack ?? (overrides.ignoreEnvSlack ? undefined : slackFromEnv(env));
  if (slack) options.slack = slack;

  // Transports: merge overrides.transports over env-derived values, unless
  // the caller has opted out via `ignoreEnvTransports`.
  const transports = overrides.ignoreEnvTransports
    ? overrides.transports
    : mergeTransports(overrides.transports, transportsFromEnv(env));
  if (transports) options.transports = transports;

  return createLogger(options);
}

function parseLevel(value: string | undefined): LogLevel | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  const valid: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];
  return valid.includes(lower as LogLevel) ? (lower as LogLevel) : undefined;
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const lower = value.toLowerCase();
  if (lower === "1" || lower === "true" || lower === "yes" || lower === "on") return true;
  if (lower === "0" || lower === "false" || lower === "no" || lower === "off") return false;
  return undefined;
}

function slackFromEnv(env: EnvSource): SlackOptions | undefined {
  const defaultWebhookUrl = env.SLACK_WEBHOOK_URL;
  const channels: Partial<Record<SlackableLevel, string>> = {};
  const mention: Partial<Record<SlackableLevel, string>> = {};

  for (const level of Object.keys(LEVEL_SUFFIXES) as SlackableLevel[]) {
    const suffix = LEVEL_SUFFIXES[level];
    const webhook = env[`SLACK_WEBHOOK_URL_${suffix}`];
    if (webhook) channels[level] = webhook;
    const m = env[`SLACK_MENTION_${suffix}`];
    if (m) mention[level] = m;
  }

  const botToken = env.SLACK_BOT_TOKEN;
  const defaultChannel = env.SLACK_CHANNEL;
  const webApiChannels: Partial<Record<SlackableLevel, string>> = {};
  for (const level of Object.keys(LEVEL_SUFFIXES) as SlackableLevel[]) {
    const suffix = LEVEL_SUFFIXES[level];
    const ch = env[`SLACK_CHANNEL_${suffix}`];
    if (ch) webApiChannels[level] = ch;
  }

  const hasWebhook = defaultWebhookUrl || Object.keys(channels).length > 0;
  // A bot token alone is enough to enable the Web API path; callers can still
  // supply a destination per-message via `slack: { channel: ... }`, which
  // SlackTransport.resolveWebApiChannel() honors even when no default is set.
  const hasWebApi = Boolean(botToken);

  if (!hasWebhook && !hasWebApi) return undefined;

  const slack: SlackOptions = {};
  if (defaultWebhookUrl) slack.defaultWebhookUrl = defaultWebhookUrl;
  if (Object.keys(channels).length > 0) slack.channels = channels;
  if (Object.keys(mention).length > 0) slack.mention = mention;
  if (hasWebApi && botToken) {
    slack.webApi = { token: botToken };
    if (defaultChannel) slack.webApi.defaultChannel = defaultChannel;
    if (Object.keys(webApiChannels).length > 0) slack.webApi.channels = webApiChannels;
  }
  return slack;
}

function transportsFromEnv(env: EnvSource): TransportOptions | undefined {
  const transports: TransportOptions = {};

  if (env.LOG_FILE) {
    transports.files = [env.LOG_FILE];
  }

  const syslogHost = env.LOG_SYSLOG_HOST;
  if (syslogHost) {
    const syslog: SyslogTransportOptions = { host: syslogHost };
    if (env.LOG_SYSLOG_PORT) {
      const port = Number(env.LOG_SYSLOG_PORT);
      if (Number.isFinite(port)) syslog.port = port;
    }
    const protocol = env.LOG_SYSLOG_PROTOCOL?.toLowerCase();
    if (protocol === "udp" || protocol === "tcp" || protocol === "tls") {
      syslog.protocol = protocol;
    }
    const rejectUnauthorized = parseBool(env.LOG_SYSLOG_REJECT_UNAUTHORIZED);
    if (rejectUnauthorized !== undefined) {
      syslog.rejectUnauthorized = rejectUnauthorized;
    }
    if (env.LOG_SYSLOG_APP_NAME) syslog.appName = env.LOG_SYSLOG_APP_NAME;
    transports.syslog = syslog;
  }

  if (Object.keys(transports).length === 0) return undefined;
  return transports;
}

function mergeTransports(
  override: TransportOptions | undefined,
  fromEnv: TransportOptions | undefined
): TransportOptions | undefined {
  if (!override && !fromEnv) return undefined;
  return { ...fromEnv, ...override };
}
