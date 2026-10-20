// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { TotonoAnalytics } from "../src/index";
const clients: TotonoAnalytics[] = [];
afterEach(() => {
  clients.forEach((c) => c.dispose());
  clients.length = 0;
  vi.useRealTimers();
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
