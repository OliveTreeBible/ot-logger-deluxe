import type { SlackMessage } from "./BlockKitBuilder.js";

export interface WebApiClientOptions {
  token: string;
}

export interface WebApiPostArgs extends SlackMessage {
  channel: string;
}

export interface WebApiSendResult {
  ok: boolean;
  error?: unknown;
  ts?: string;
}

/**
 * Minimal wrapper around `@slack/web-api`'s `WebClient.chat.postMessage`.
 * `@slack/web-api` is declared as an optional peer dependency and loaded lazily.
 */
export class WebApiClient {
  private readonly token: string;
  private client: unknown;

  constructor(opts: WebApiClientOptions) {
    this.token = opts.token;
  }

  async send(args: WebApiPostArgs): Promise<WebApiSendResult> {
    try {
      const client = await this.getClient();
      const res = (await (client as {
        chat: {
          postMessage: (input: {
            channel: string;
            text: string;
            blocks: unknown;
          }) => Promise<{ ok: boolean; ts?: string; error?: string }>;
        };
      }).chat.postMessage({
        channel: args.channel,
        text: args.text,
        blocks: args.blocks,
      })) as { ok: boolean; ts?: string; error?: string };

      if (!res.ok) {
        return { ok: false, error: new Error(res.error ?? "slack web api error") };
      }
      return { ok: true, ts: res.ts };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  private async getClient(): Promise<unknown> {
    if (this.client) return this.client;
    let mod: { WebClient: new (token: string) => unknown };
    try {
      mod = (await import("@slack/web-api")) as unknown as {
        WebClient: new (token: string) => unknown;
      };
    } catch (err) {
      throw new Error(
        "Slack Web API transport requires the '@slack/web-api' package. " +
          "Install it with `npm install @slack/web-api`.",
        { cause: err }
      );
    }
    this.client = new mod.WebClient(this.token);
    return this.client;
  }
}
