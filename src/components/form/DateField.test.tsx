import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import DateField from "./DateField";
import { setShopDayRule } from "../../common/shopDay";

// The real hook takes the day rule away again for anybody who is not signed in
// to a shop; here the shop is told its rule by the test, as the settings would.
vi.mock("../../modules/shop/hooks/useShop", () => ({ useDateFormat: () => "dmy" }));

/**
 * #AZ1 — ONE SCREEN, TWO "TODAYS".
 *
 * At 01:13 in Karachi the shop is still trading on the 30th: the day turns at
 * five. The expense form prefilled the 30th (the shop's day), but typing
 * "today" into the same box gave the 31st — the device's wall date — so an
 * expense keyed at one in the morning landed in the next day's books.
 */
const inAnApp = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("a typed word means the shop's day", () => {
  afterEach(() => {
    vi.useRealTimers();
    setShopDayRule(null);
  });

  it.each([
    ["today", "2026-10-30"],
    ["yesterday", "2026-10-29"],
    ["tomorrow", "2026-10-31"],
  ])("“%s” at 01:13, before the 05:00 turn, is %s", (word, day) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 20:13 UTC on the 30th = 01:13 on the 31st in Karachi (UTC+5).
    vi.setSystemTime(new Date("2026-10-30T20:13:00Z"));
    setShopDayRule({ zone: "Asia/Karachi", turnsAtMinutes: 300 });
    const onChange = vi.fn();

    inAnApp(<DateField aria-label="Date" format="dmy" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: word } });

    expect(onChange).toHaveBeenLastCalledWith(day);
  });

  it("after the turn the shop's day and the wall agree", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 01:00 UTC on the 31st = 06:00 in Karachi — the day has turned.
    vi.setSystemTime(new Date("2026-10-31T01:00:00Z"));
    setShopDayRule({ zone: "Asia/Karachi", turnsAtMinutes: 300 });
    const onChange = vi.fn();

    inAnApp(<DateField aria-label="Date" format="dmy" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "today" } });

    expect(onChange).toHaveBeenLastCalledWith("2026-10-31");
  });
});
