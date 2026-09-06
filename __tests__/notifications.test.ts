import { PROJECT_ROOT, fs, path } from "./support/node";
import { notificationKind, timeAgo } from "../src/modules/account/notificationKinds";

/**
 * A NOTIFICATION IS A POINTER.
 *
 * The list drew every row identically — a bold line, a grey line — and none of
 * them went anywhere. "Rider on the way" and "Order cancelled" looked the
 * same, read the same at a glance, and both did nothing when pressed.
 *
 * Wrong twice over. A notification's whole job is to get somebody to the thing
 * it is about, so a list of pointers that point nowhere is a list of receipts.
 * And the one thing that separates them — good news, bad news, or something to
 * act on — was carried only by words somebody had to read.
 *
 * The server had been sending `type` and `data` since notifications existed.
 * The app was reading the title and throwing the rest away.
 */

const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("what a notification is about", () => {
  it("tells good news from bad", () => {
    expect(notificationKind("order.completed").tone).toBe("good");
    expect(notificationKind("order.cancelled").tone).toBe("bad");
    // "Act" is the third question a list is scanned for: is this one MINE to
    // do something about. A rider's offer expires; a shop with no rider loses
    // money while nobody looks.
    expect(notificationKind("rider.job_offered").tone).toBe("act");
    expect(notificationKind("order.no_rider").tone).toBe("bad");
  });

  it("gives every kind its own mark", () => {
    const kinds = [
      "order.placed",
      "order.rider_assigned",
      "order.completed",
      "order.cancelled",
      "rider.job_offered",
      "reservation.accepted",
    ].map((t) => notificationKind(t).icon);

    // Not all identical — the mark is what tells them apart before the words.
    expect(new Set(kinds).size).toBeGreaterThanOrEqual(4);
  });

  it("never drops a type it has not heard of", () => {
    // A server that adds a notification type must not make the message
    // invisible. Somebody was sent it; showing it without a mark beats not
    // showing it at all.
    const unknown = notificationKind("loyalty.points_earned");
    expect(unknown.icon).toBeDefined();
    expect(unknown.tone).toBe("info");
    expect(unknown.target).toBeUndefined();
    expect(notificationKind(null).icon).toBeDefined();
  });
});

describe("where a press lands", () => {
  it("opens the order a message is about", () => {
    expect(notificationKind("order.out_for_delivery").target?.({ order_id: "o1" })).toEqual({
      route: "Order",
      params: { id: "o1" },
    });
  });

  it("sends a RIDER to the job screen, not the customer's order", () => {
    // Same id, two different screens. A rider opening "New delivery" wants the
    // pickup address and the collect button, not a tracking map of themselves.
    expect(notificationKind("rider.job_offered").target?.({ order_id: "o1" })).toEqual({
      route: "RiderJob",
      params: { id: "o1" },
    });
  });

  it("leads nowhere rather than somewhere wrong", () => {
    // A notification whose data lost its id — and the row renders without a
    // chevron rather than as a button that does nothing.
    expect(notificationKind("order.completed").target?.({})).toBeNull();
    expect(notificationKind("rider.approved").target).toBeUndefined();
  });
});

describe("how long ago", () => {
  const now = new Date("2026-09-06T18:00:00");

  it("says it in the words people use", () => {
    expect(timeAgo("2026-09-06T17:59:30", now)).toBe("Just now");
    expect(timeAgo("2026-09-06T17:20:00", now)).toBe("40m");
    expect(timeAgo("2026-09-06T12:00:00", now)).toBe("6h");
    expect(timeAgo("2026-09-04T18:00:00", now)).toBe("2d");
    expect(timeAgo("2026-08-23T18:00:00", now)).toBe("2w");
  });

  it("becomes a date once ago stops meaning anything", () => {
    const old = timeAgo("2026-06-01T18:00:00", now);
    expect(old).toMatch(/Jun/);
    expect(old).not.toMatch(/w$/);
  });

  it("says nothing rather than 'Invalid Date'", () => {
    expect(timeAgo(null)).toBe("");
    expect(timeAgo("not a date")).toBe("");
  });
});

describe("the screen uses all of it", () => {
  const screen = codeOnly(
    fs.readFileSync(
      path.join(PROJECT_ROOT, "src/modules/account/screens/NotificationsScreen.tsx"),
      "utf8",
    ),
  );

  it("reads the type and the data the server sends", () => {
    expect(screen).toMatch(/type\?: string \| null;/);
    expect(screen).toMatch(/data\?: Record<string, unknown> \| null;/);
    expect(screen).toMatch(/notificationKind\(item\.type\)/);
    expect(screen).toMatch(/kind\.target\?\.\(item\.data \?\? \{\}\)/);
  });

  it("does not offer a press on a row that leads nowhere", () => {
    expect(screen).toMatch(/disabled=\{to == null\}/);
  });

  it("marks it read without making the tap wait for the network", () => {
    // A notification about an order out for delivery should open that order at
    // the speed of a tap, not the speed of the request that marks it read.
    expect(screen).toMatch(/queryClient\.setQueryData/);
    expect(screen).toMatch(/apiPost\(`\/notifications\/\$\{n\.id\}\/read`\)\.catch/);
    // The navigation is not inside a `then`.
    expect(screen).toMatch(/if \(to != null\) navigation\.navigate\(to\.route, to\.params\);/);
  });
});
