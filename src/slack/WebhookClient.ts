import type { SlackMessage } from "./BlockKitBuilder.js";

export interface WebhookClientOptions {
  /** Max send attempts (including the first). Default 3. */
  attempts?: number;
  /** Initial backoff in ms; doubled each retry. Default 250. */
  baseDelayMs?: number;
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Inject a custom fetch for testing; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Called when an attempt fails but more are remaining. */
  onRetry?: (info: { attempt: number; status?: number; error?: unknown }) => void;
}

export interface SendResult {
  ok: boolean;
  status?: number;
  attempts: number;
  error?: unknown;
}

/** Minimal, retrying HTTP client for Slack Incoming Webhooks. */
export class WebhookClient {
  private readonly attempts: number;
  private readonly baseDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onRetry?: (info: { attempt: number; status?: number; error?: unknown }) => void;

  constructor(opts: WebhookClientOptions = {}) {
    this.attempts = Math.max(1, opts.attempts ?? 3);
    this.baseDelayMs = Math.max(0, opts.baseDelayMs ?? 250);
    this.timeoutMs = Math.max(1, opts.timeoutMs ?? 5000);
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.onRetry = opts.onRetry;
  }

  async send(url: string, body: SlackMessage): Promise<SendResult> {
    const payload = JSON.stringify(body);
    let lastError: unknown;
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const signal =
          typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
            ? AbortSignal.timeout(this.timeoutMs)
            : createTimeoutSignal(this.timeoutMs);

        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal,
        });

        if (res.ok) {
          return { ok: true, status: res.status, attempts: attempt };
        }

        lastStatus = res.status;
        lastError = new Error(`Slack webhook HTTP ${res.status}`);

        if (!this.isRetryable(res.status) || attempt === this.attempts) {
          return { ok: false, status: res.status, attempts: attempt, error: lastError };
        }

        const retryAfter = parseRetryAfter(res.headers);
        this.onRetry?.({ attempt, status: res.status });
        await sleep(retryAfter ?? this.backoff(attempt));
      } catch (err) {
        lastError = err;
        lastStatus = undefined;

        if (attempt === this.attempts) {
          return { ok: false, attempts: attempt, error: err };
        }

        this.onRetry?.({ attempt, error: err });
        await sleep(this.backoff(attempt));
      }
    }

    return { ok: false, status: lastStatus, attempts: this.attempts, error: lastError };
  }

  private isRetryable(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  private backoff(attempt: number): number {
    return this.baseDelayMs * 2 ** (attempt - 1);
  }
}

function parseRetryAfter(headers: Headers): number | undefined {
  const header = headers.get("retry-after");
  if (!header) return undefined;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber)) {
    return Math.max(0, asNumber * 1000);
  }
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("timeout")), ms).unref?.();
  return controller.signal;
}
