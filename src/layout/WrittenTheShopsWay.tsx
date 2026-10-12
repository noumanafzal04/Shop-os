import { Fragment, type ReactNode } from "react";

import { setShopDateFormat } from "../common/format/date";
import { useDateFormat, useDateFormatIsKnown } from "../modules/shop/hooks/useShop";

/**
 * EVERY PAGE BELOW IS WRITTEN IN THE SHOP'S DATES — from its first frame.
 *
 * How a shop writes a date is held once (common/format/date.ts) and read by
 * some three hundred plain functions, none of which can be told when it
 * changes. Three things make that safe, and all three are here:
 *
 *   it is told BEFORE the pages are drawn — in this render, not in an effect
 *     after it, which would be one frame of somebody else's dates;
 *
 *   the pages are not drawn until it is KNOWN. On a device's very first visit
 *     that is the fraction of a second the shop's settings take. The first
 *     version drew the page in the default and drew it again when the
 *     settings landed — and a button pressed in between ("Add expense")
 *     opened a sheet that the second drawing threw away. A press that does
 *     nothing is the worst thing a screen can do;
 *
 *   when it CHANGES — the owner picks another format, here or on another
 *     device — the pages are drawn again from nothing. A page that kept half
 *     its rows in the old way would be worse than a blink, and that moment is
 *     one somebody chose.
 */
export function WrittenTheShopsWay({ children }: { children: ReactNode }) {
  const format = useDateFormat();
  const known = useDateFormatIsKnown();
  setShopDateFormat(format);

  if (!known) {
    return <div aria-busy="true" aria-label="Loading" className="h-64 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />;
  }

  return <Fragment key={format}>{children}</Fragment>;
}
