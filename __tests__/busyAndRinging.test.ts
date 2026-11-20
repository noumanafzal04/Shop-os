import { fs, path, PROJECT_ROOT, codeOnly } from "./support/node";
import { activePause, backAt, minutesLeft, PAUSE_CHOICES } from "../src/modules/shop/pause";
import { nextToRing, waitingBehind, waited } from "../src/modules/orders/incoming";
import type { Order } from "../src/modules/orders/services/ordersService";

/**
 * THE TWO THINGS A SHOP REACHES FOR MID-SHIFT, foodpanda's vendor app:
 *   - "Busy": pause online orders for a while; the shop opens again by itself.
 *   - A new order takes the screen and buzzes until it is answered.
 */
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("busy — orders paused for a while", () => {
  const now = new Date("2026-11-20T14:00:00");

  it("never offers 'until I turn it back on' — every choice ends by itself", () => {
    expect(PAUSE_CHOICES.map((p) => p.label)).toEqual(["15 minutes", "30 minutes", "1 hour", "2 hours", "Rest of today"]);
    for (const p of PAUSE_CHOICES) {
      const b = p.body as { minutes?: number; rest_of_day?: boolean };
      expect(b.rest_of_day === true || (b.minutes! >= 5 && b.minutes! <= 1440)).toBe(true);
    }
  });

  it("a pause that has run out is no pause", () => {
    expect(activePause("2026-11-20T13:59:00", now)).toBeNull();
    expect(activePause("2026-11-20T14:30:00", now)?.getMinutes()).toBe(30);
    expect(activePause(null, now)).toBeNull();
    expect(activePause("not a date", now)).toBeNull();
  });

  it("says when it opens again, in words", () => {
    expect(backAt(new Date("2026-11-20T19:45:00"), now)).toBe("back at 7:45 PM");
    expect(backAt(new Date("2026-11-20T23:59:59"), now)).toBe("back tomorrow");
    expect(backAt(new Date("2026-11-21T09:00:00"), now)).toBe("back tomorrow");
    expect(minutesLeft(new Date("2026-11-20T14:12:30"), now)).toBe(13);
  });

  it("the home tab carries the card, and it calls the server's pause", () => {
    expect(read("src/modules/dashboard/screens/DashboardScreen.tsx")).toMatch(/<BusyCard \/>/);
    const svc = read("src/modules/shop/services/shopService.ts");
    expect(svc).toMatch(/apiPost<[^>]+>\("\/shop\/orders\/pause", body\)/);
    expect(svc).toMatch(/apiDelete<[^>]+>\("\/shop\/orders\/pause"\)/);
  });
});

describe("a new order rings until it is answered", () => {
  const o = (id: string, placed: string, status = "pending") =>
    ({ id, order_number: id.toUpperCase(), status, placed_at: placed } as unknown as Order);
  const list = [o("b", "2026-11-20T14:05:00Z"), o("a", "2026-11-20T14:01:00Z"), o("c", "2026-11-20T14:09:00Z", "confirmed")];

  it("rings the one that has waited longest first", () => {
    expect(nextToRing(list, new Set())?.id).toBe("a");
    expect(waitingBehind(list, new Set())).toBe(1);
  });

  it("'Later' puts off that order only; the next one still rings", () => {
    expect(nextToRing(list, new Set(["a"]))?.id).toBe("b");
    expect(nextToRing(list, new Set(["a", "b"]))).toBeNull();
  });

  it("never rings for an order already accepted", () => {
    expect(nextToRing([o("c", "2026-11-20T14:09:00Z", "confirmed")], new Set())).toBeNull();
  });

  it("says how long the customer has waited", () => {
    const now = new Date("2026-11-20T14:10:00Z");
    expect(waited("2026-11-20T14:09:40Z", now)).toBe("just now");
    expect(waited("2026-11-20T14:03:00Z", now)).toBe("7 min ago");
    expect(waited("2026-11-20T12:55:00Z", now)).toBe("1 h 15 min ago");
  });

  it("is mounted over the whole app, buzzes while shown, and accepts/rejects on the server", () => {
    expect(read("src/navigation/RootNavigator.tsx")).toMatch(/<IncomingOrderHost/);
    const host = read("src/modules/orders/components/IncomingOrderHost.tsx");
    expect(host).toMatch(/Vibration\.vibrate\(RING_PATTERN, true\)/);
    expect(host).toMatch(/return \(\) => Vibration\.cancel\(\)/);
    expect(host).toMatch(/status: "confirmed"/);
    expect(host).toMatch(/cancel\.mutate\(/);
    expect(host).toMatch(/holds\(user, "orders\.manage"\)/);
    expect(read("android/app/src/main/AndroidManifest.xml")).toMatch(/android\.permission\.VIBRATE/);
  });
});
