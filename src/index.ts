export type Properties = Record<string, string | number | boolean | null>;
export type AnalyticsOptions = {
  endpoint: string;
  key: string;
  appVersion?: string;
  environment?: "production" | "test";
  namespace?: string;
  flushIntervalMs?: number;
  storage?: Storage;
  fetch?: typeof fetch;
};
type Event = {
  id: string;
  timestamp: string;
  name: string;
  installationId: string;
  sessionId: string;
  customerId?: string;
  environment: "production" | "test";
  platform: "web";
  appVersion: string;
  properties: Properties;
};
/** Explicit event tracking. All storage is scoped to this client; nothing is sent on construction. */
export class TotonoAnalytics {
  private queue: Event[] = [];
  private customerId?: string;
  private installationId = "";
  private sessionId = "";
  private optedOut = false;
  private storage?: Storage;
  private prefix: string;
  private timer: ReturnType<typeof setInterval>;
  private sending?: Promise<void>;
  private retryAt = 0;
  private failures = 0;
  private readonly request: typeof fetch;
  constructor(private readonly options: AnalyticsOptions) {
    if ((options.appVersion?.length || 0) > 80)
      throw Error("invalid_app_version");
    const url = new URL(options.endpoint);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw Error("invalid_endpoint");
    this.request = options.fetch || globalThis.fetch.bind(globalThis);
    this.prefix = `totono.analytics.${options.namespace || options.key}`;
    try {
      this.storage = options.storage || globalThis.localStorage;
      this.optedOut = this.storage?.getItem(this.prefix + ".optout") === "true";
      if (!this.optedOut) {
        this.installationId =
          this.storage?.getItem(this.prefix + ".installation") ||
          crypto.randomUUID();
        this.sessionId = crypto.randomUUID();
        this.storage?.setItem(
          this.prefix + ".installation",
          this.installationId,
        );
        const stored = JSON.parse(
          this.storage?.getItem(this.prefix + ".queue") || "[]",
        );
        if (Array.isArray(stored))
          this.queue = stored
            .filter(
              (e) =>
                e &&
                typeof e.id === "string" &&
                Date.parse(e.timestamp) > Date.now() - 7 * 86400000,
            )
            .slice(-1000);
      }
    } catch {
      this.storage = undefined;
      if (!this.optedOut) {
        this.installationId = crypto.randomUUID();
        this.sessionId = crypto.randomUUID();
      }
    }
    this.timer = setInterval(
      () => void this.flush(),
      Math.max(1000, options.flushIntervalMs || 10000),
    );
  }
  track(name: string, properties: Properties = {}): void {
    if (this.optedOut) return;
    if (
      !name.trim() ||
      name.trim().length > 120 ||
      Object.keys(properties).length > 32 ||
      Object.entries(properties).some(
        ([k, v]) =>
          !k ||
          k.length > 80 ||
          !(
            v === null ||
            typeof v === "boolean" ||
            (typeof v === "number" && Number.isFinite(v)) ||
            (typeof v === "string" && v.length <= 1024)
          ),
      )
    )
      throw Error("invalid_event");
    const event: Event = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      name: name.trim(),
      installationId: this.installationId,
      sessionId: this.sessionId,
      customerId: this.customerId,
      environment: this.options.environment || "production",
      platform: "web",
      appVersion: this.options.appVersion || "",
      properties: { ...properties },
    };
    this.queue.push(event);
    if (this.queue.length > 1000) this.queue.shift();
    this.persist();
    if (this.queue.length >= 100) void this.flush();
  }
  identify(customerId: string): void {
    if (!customerId || customerId.length > 200)
      throw Error("invalid_identifier");
    if (!this.optedOut) this.customerId = customerId;
  }
  reset(): void {
    this.customerId = undefined;
    if (this.optedOut) return;
    this.installationId = crypto.randomUUID();
    this.sessionId = crypto.randomUUID();
    try {
      this.storage?.setItem(this.prefix + ".installation", this.installationId);
    } catch {
      /* In-memory identity remains usable. */
    }
  }
  setOptOut(value: boolean): void {
    this.optedOut = value;
    this.customerId = undefined;
    try {
      this.storage?.setItem(this.prefix + ".optout", String(value));
    } catch {
      /* In-memory preference still applies. */
    }
    if (value) {
      this.queue = [];
      this.installationId = "";
      this.sessionId = "";
      try {
        this.storage?.removeItem(this.prefix + ".installation");
        this.storage?.removeItem(this.prefix + ".queue");
      } catch {
        /* Best-effort device storage cleanup. */
      }
    } else if (!this.installationId) this.reset();
  }
  flush(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = this.send().finally(() => {
      this.sending = undefined;
    });
    return this.sending;
  }
  private async send(): Promise<void> {
    if (this.optedOut || Date.now() < this.retryAt) return;
    this.queue = this.queue.filter(
      (e) => Date.parse(e.timestamp) > Date.now() - 7 * 86400000,
    );
    const events: Event[] = [];
    for (const event of this.queue.slice(0, 100)) {
      if (
        new TextEncoder().encode(JSON.stringify({ events: [...events, event] }))
          .length >
        200 * 1024
      )
        break;
      events.push(event);
    }
    if (!events.length) return;
    try {
      const response = await this.request(this.options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Totono-Analytics-Key": this.options.key,
        },
        body: JSON.stringify({ events }),
        credentials: "omit",
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok || [400, 413, 415].includes(response.status)) {
        const ids = new Set(events.map((e) => e.id));
        this.queue = this.queue.filter((e) => !ids.has(e.id));
        this.failures = 0;
        this.retryAt = 0;
        this.persist();
      } else this.backoff(response.headers.get("Retry-After"));
    } catch {
      this.backoff(null);
    }
  }
  private backoff(retryAfter: string | null) {
    this.failures++;
    const header = retryAfter
      ? Number(retryAfter) * 1000 || Date.parse(retryAfter) - Date.now()
      : 0;
    this.retryAt =
      Date.now() +
      Math.max(
        header,
        Math.min(300000, 1000 * 2 ** Math.min(this.failures, 8)),
      );
  }
  private persist() {
    try {
      if (!this.optedOut)
        this.storage?.setItem(
          this.prefix + ".queue",
          JSON.stringify(this.queue),
        );
    } catch {
      /* The bounded in-memory queue remains available. */
    }
  }
  getInstallationId(): string | null {
    return this.optedOut ? null : this.installationId;
  }
  dispose(): void {
    clearInterval(this.timer);
  }
}
