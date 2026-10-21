// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { TotonoAnalytics } from "../src/index";
const clients: TotonoAnalytics[] = [];
afterEach(() => {
  clients.forEach((c) => c.dispose());
  clients.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function client(
  request = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response("{}", { status: 202 }),
  ),
) {
  const c = new TotonoAnalytics({
    endpoint: "https://analytics.example.com/events",
    key: "tta_test",
    fetch: request,
  });
  clients.push(c);
  return { c, request };
}
describe("JavaScript analytics client", () => {
  it("sends the shared API contract and identifies only future events", async () => {
    const { c, request } = client();
    c.track("before");
    c.identify("customer");
    c.track("after", { amount: 12 });
    await c.flush();
    const events = JSON.parse(request.mock.calls[0][1]!.body as string).events;
    expect(events[0].customerId).toBeUndefined();
    expect(events[1].customerId).toBe("customer");
    expect(events[1].platform).toBe("web");
    expect(events[0].id).not.toBe(events[1].id);
  });
  it("preserves IDs and timestamps on retries and honors Retry-After", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "Retry-After": "60" } }),
      )
      .mockResolvedValue(new Response("{}", { status: 202 }));
    const { c } = client(request);
    c.track("retry");
    await c.flush();
    c.setContext({ language: "cs-CZ", colorScheme: "dark" });
    await c.flush();
    expect(request).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 60001);
    await c.flush();
    expect(request.mock.calls[1][1].body).toBe(request.mock.calls[0][1].body);
  });
  it("opt-out clears queued events and reset changes installation identity", async () => {
    const { c, request } = client();
    const id = c.getInstallationId();
    c.track("discard");
    c.setOptOut(true);
    c.track("ignored");
    await c.flush();
    expect(request).not.toHaveBeenCalled();
    expect(c.getInstallationId()).toBeNull();
    c.setOptOut(false);
    expect(c.getInstallationId()).not.toBe(id);
    c.identify("old");
    c.reset();
    c.track("new");
    await c.flush();
    expect(
      JSON.parse(request.mock.calls[0][1]!.body as string).events[0].customerId,
    ).toBeUndefined();
  });
  it("caps request size and never duplicates sends during concurrent flushes", async () => {
    const request = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}", { status: 202 }),
    );
    const { c } = client(request);
    for (let i = 0; i < 8; i++)
      c.track(
        "large",
        Object.fromEntries(
          Array.from({ length: 32 }, (_, n) => ["p" + n, "x".repeat(1024)]),
        ),
      );
    await Promise.all([c.flush(), c.flush()]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      new TextEncoder().encode(request.mock.calls[0][1]!.body as string).length,
    ).toBeLessThan(256 * 1024);
  });
});

it("snapshots device context and applies updateable app overrides only to future events", async () => {
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile", language: "cs-CZ" });
  vi.stubGlobal("screen", { width: 393, height: 852 });
  vi.stubGlobal("devicePixelRatio", 3);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { c, request } = client();
  c.track("system");
  c.setContext({ language: "en-US", colorScheme: "light" });
  c.track("override");
  vi.stubGlobal("screen", { width: 852, height: 393 });
  c.setContext({});
  c.track("reset");
  await c.flush();
  const events = JSON.parse(request.mock.calls[0][1]!.body as string).events;
  expect(events[0]).toMatchObject({ deviceType: "phone", osName: "iOS", osVersion: "18.1", sdkVersion: "0.2.0",
    screenWidth: 393, screenHeight: 852, screenScale: 3, colorScheme: "dark", language: "cs-CZ" });
  expect(events[0].deviceModel).toBeUndefined();
  expect(events[1]).toMatchObject({ language: "en-US", colorScheme: "light", screenWidth: 393 });
  expect(events[2]).toMatchObject({ language: "cs-CZ", colorScheme: "dark", screenWidth: 852 });
  expect(() => c.setContext({ language: "en_US" })).toThrow("invalid_language");
});
it("keeps tracking when device APIs are absent or throw", async () => {
  vi.stubGlobal("navigator", undefined);
  vi.stubGlobal("screen", { get width() { throw Error(); }, height: -1 });
  vi.stubGlobal("matchMedia", () => { throw Error(); });
  vi.stubGlobal("devicePixelRatio", NaN);
  const { c, request } = client();
  c.track("headless");
  await c.flush();
  const e = JSON.parse(request.mock.calls[0][1]!.body as string).events[0];
  expect(e.sdkVersion).toBe("0.2.0");
  expect(e.screenWidth).toBeUndefined();
  expect(e.screenHeight).toBeUndefined();
  expect(e.screenScale).toBeUndefined();
});
it.each([
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, "tablet", "iOS"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0, "desktop", "Windows"],
  ["Mozilla/5.0 (Linux; Android 10; K) Mobile", 0, "phone", "Android"],
])("collects device class without inventing frozen OS versions (%s)", async (ua, touches, type, os) => {
  vi.stubGlobal("navigator", { userAgent: ua, maxTouchPoints: touches });
  const { c, request } = client();
  c.track("device"); await c.flush();
  const e = JSON.parse(request.mock.calls[0][1]!.body as string).events[0];
  expect(e).toMatchObject({ deviceType: type, osName: os });
  expect(e.osVersion).toBeUndefined();
});
it("restores legacy persisted events unchanged beside new events", async () => {
  const prefix = "totono.analytics.upgrade";
  const legacy = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), name: "old", installationId: "i",
    sessionId: "s", environment: "production", platform: "web", appVersion: "1", properties: {} };
  const values = new Map([[prefix + ".queue", JSON.stringify([legacy])]]);
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k) } as unknown as Storage;
  const request = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 202 }));
  const c = new TotonoAnalytics({ endpoint: "https://example.com/events", key: "key", namespace: "upgrade", storage, fetch: request });
  clients.push(c);
  c.track("new"); await c.flush();
  const events = JSON.parse(request.mock.calls[0][1]!.body as string).events;
  expect(events[0]).toEqual(legacy);
  expect(events[1].sdkVersion).toBe("0.2.0");
});
