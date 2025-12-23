export interface TransportInit {
  /** Optional fetch implementation (useful for SSR / custom runtimes). */
  fetchFn?: typeof fetch;
  /** Default timeout applied to requests (ms). */
  timeoutMs?: number;
}

export class SnowyHttpError extends Error {
  public readonly name = "SnowyHttpError";
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;
  public readonly bodyText: string;

  constructor(args: { status: number; statusText: string; url: string; bodyText: string }) {
    super(`Snowy SDK: HTTP ${args.status} ${args.statusText}`);
    this.status = args.status;
    this.statusText = args.statusText;
    this.url = args.url;
    this.bodyText = args.bodyText;
  }
}

export class SnowyTransportError extends Error {
  public readonly name = "SnowyTransportError";
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

export class Transport {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number | undefined;

  constructor(init: TransportInit = {}) {
    const f = init.fetchFn ?? (globalThis as unknown as { fetch?: typeof fetch }).fetch;
    if (!f) {
      throw new Error(
        "Snowy SDK: fetch is not available in this runtime. Provide TransportInit.fetchFn."
      );
    }
    this.fetchFn = f;
    this.timeoutMs = init.timeoutMs;
  }

  async postJson<TReq, TRes>(
    url: string,
    body: TReq,
    init?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<TRes> {
    const timeoutMs = init?.timeoutMs ?? this.timeoutMs;
    const controller = timeoutMs ? new AbortController() : undefined;
    const timer = timeoutMs
      ? setTimeout(() => controller?.abort(new Error("Snowy SDK: request timeout")), timeoutMs)
      : undefined;

    try {
      const signal = (init?.signal ?? controller?.signal) ?? null;
      const res = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(body),
        signal
      });

      const text = await res.text();
      if (!res.ok) {
        throw new SnowyHttpError({
          status: res.status,
          statusText: res.statusText,
          url,
          bodyText: text
        });
      }

      if (text.length === 0) {
        throw new SnowyTransportError("Snowy SDK: empty JSON response body");
      }

      try {
        return JSON.parse(text) as TRes;
      } catch (e) {
        throw new SnowyTransportError("Snowy SDK: failed to parse JSON response", e);
      }
    } catch (e) {
      if (e instanceof SnowyHttpError) throw e;
      if (e instanceof SnowyTransportError) throw e;
      throw new SnowyTransportError("Snowy SDK: network or fetch failure", e);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
