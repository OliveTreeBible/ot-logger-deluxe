import type { NormalizedField } from "../internal/coerce.js";
import type { SlackOptions, SlackableLevel } from "../types.js";
import { buildSlackMessage } from "./BlockKitBuilder.js";
import { WebApiClient } from "./WebApiClient.js";
import { WebhookClient } from "./WebhookClient.js";

export interface SlackTransportContext {
  hostname: string;
  loggerName: string;
  /** Called when a send fails after all retries. Must never throw. */
  onTransportError: (info: { level: SlackableLevel; status?: number; error?: unknown }) => void;
}

export interface SlackPostArgs {
  level: SlackableLevel;
  message: string;
  fields: NormalizedField[];
  error?: unknown;
  code?: string;
  channelOverride?: string;
  mentionOverride?: string;
}

/**
 * Resolves each log event to a destination (webhook URL and/or Web API channel)
 * and dispatches the formatted Slack message. Never throws: failures are routed
 * through the supplied `onTransportError` callback.
 */
export class SlackTransport {
  private readonly options: SlackOptions;
  private readonly ctx: SlackTransportContext;
  private readonly webhookClient: WebhookClient;
  private readonly webApiClient?: WebApiClient;
  /**
   * In-flight sends. `Logger.log()` fires sends without awaiting them so the
   * caller isn't blocked on retries; `drained()` lets a user await completion
   * at shutdown / test time.
   */
  private readonly pending: Set<Promise<void>> = new Set();

  constructor(options: SlackOptions, ctx: SlackTransportContext) {
    this.options = options;
    this.ctx = ctx;

    // Always construct the WebhookClient: it holds no handles until send() is
    // called, and per-message slack: { channel: "https://hooks.slack..." }
    // overrides can resolve a valid webhook URL even when no webhook is set
    // in the static options. Conditional construction would silently drop
    // those sends.
    this.webhookClient = new WebhookClient({
      attempts: options.retry?.attempts,
      baseDelayMs: options.retry?.baseDelayMs,
      timeoutMs: options.retry?.timeoutMs,
    });

    if (options.webApi?.token) {
      this.webApiClient = new WebApiClient({ token: options.webApi.token });
    }
  }

  /**
   * Resolve once every in-flight Slack send has settled (ok or failed).
   * `Logger.flush()` calls this at shutdown; most application code never
   * needs it directly.
   */
  async drained(): Promise<void> {
    if (this.pending.size === 0) return;
    await Promise.allSettled([...this.pending]);
  }

  /** True if at least one destination can be resolved for the given level. */
  canDeliver(level: SlackableLevel, channelOverride?: string): boolean {
    return (
      this.resolveWebhookUrl(level, channelOverride) !== undefined ||
      this.resolveWebApiChannel(level, channelOverride) !== undefined
    );
  }

  /** Post a formatted Slack message for the given log event. */
  async post(args: SlackPostArgs): Promise<void> {
    const webhookUrl = this.resolveWebhookUrl(args.level, args.channelOverride);
    const webApiChannel = this.resolveWebApiChannel(args.level, args.channelOverride);

    if (!webhookUrl && !webApiChannel) return;

    const mention =
      args.mentionOverride !== undefined
        ? args.mentionOverride
        : this.options.mention?.[args.level];

    const slackMessage = buildSlackMessage({
      level: args.level,
      title: this.ctx.loggerName,
      message: args.message,
      fields: args.fields,
      error: args.error,
      code: args.code,
      hostname: this.options.hostname ?? this.ctx.hostname,
      timestamp: new Date(),
      mention,
    });

    const sends: Promise<void>[] = [];

    if (webhookUrl) {
      sends.push(
        this.webhookClient.send(webhookUrl, slackMessage).then((res) => {
          if (!res.ok) {
            this.ctx.onTransportError({
              level: args.level,
              status: res.status,
              error: res.error,
            });
          }
        })
      );
    }

    if (webApiChannel && this.webApiClient) {
      sends.push(
        this.webApiClient
          .send({ ...slackMessage, channel: webApiChannel })
          .then((res) => {
            if (!res.ok) {
              this.ctx.onTransportError({
                level: args.level,
                error: res.error,
              });
            }
          })
      );
    }

    if (sends.length === 0) return;

    // Track the aggregated send so `drained()` can await it, but resolve the
    // outer `post()` promise when all sends finish so callers that *want* to
    // await a specific message's delivery (tests, shutdown) still can.
    const all = Promise.all(sends).then(() => undefined);
    this.pending.add(all);
    try {
      await all;
    } finally {
      this.pending.delete(all);
    }
  }

  private resolveWebhookUrl(
    level: SlackableLevel,
    channelOverride?: string
  ): string | undefined {
    if (channelOverride) {
      if (isHttpUrl(channelOverride)) return channelOverride;
      const named = this.options.channels?.[channelOverride as SlackableLevel];
      if (named) return named;
    }
    return this.options.channels?.[level] ?? this.options.defaultWebhookUrl;
  }

  private resolveWebApiChannel(
    level: SlackableLevel,
    channelOverride?: string
  ): string | undefined {
    const webApi = this.options.webApi;
    if (!webApi) return undefined;
    if (channelOverride && !isHttpUrl(channelOverride)) return channelOverride;
    return webApi.channels?.[level] ?? webApi.defaultChannel;
  }

}

function isHttpUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}
