import { describe, expect, it } from "vitest";

import { nextParams } from "./useUrlFilters";

const params = (query: string) => new URLSearchParams(query);
const asObject = (p: URLSearchParams) => Object.fromEntries(p.entries());

/**
 * The one rule and its one exception, tested where no screen can hide it.
 *
 * The bug this exists for: a `patch` that cleared `page` on every change also
 * cleared the page the pager had just set, so Next and Previous did nothing at
 * all. Nothing threw, nothing logged, and the list redrew itself identically —
 * the URL had been rewritten to what it already was.
 */
describe("changing a filter", () => {
  it("returns to page one, because page 4 of a different filter usually does not exist", () => {
    expect(asObject(nextParams(params("page=4"), { city: "lahore" }))).toEqual({ city: "lahore" });
  });

  it("keeps every other filter", () => {
    expect(asObject(nextParams(params("city=lahore&plan=basic"), { plan: "premium" }))).toEqual({
      city: "lahore",
      plan: "premium",
    });
  });

  it("treats an empty value as clearing the filter, not as filtering on nothing", () => {
    // A screen says "no filter" by passing "". Storing that literally would
    // filter on the empty string, which matches nothing at all.
    expect(asObject(nextParams(params("city=lahore"), { city: "" }))).toEqual({});
    expect(asObject(nextParams(params("city=lahore"), { city: null }))).toEqual({});
    expect(asObject(nextParams(params("city=lahore"), { city: undefined }))).toEqual({});
  });

  it("writes a checkbox as 1 when on and removes it when off", () => {
    expect(asObject(nextParams(params(""), { online: true }))).toEqual({ online: "1" });
    expect(asObject(nextParams(params("online=1"), { online: false }))).toEqual({});
  });
});

describe("turning the page", () => {
  it("keeps the page it was given", () => {
    // THE REGRESSION. `patch` clears page on every change; the page is the
    // one thing that must survive being changed.
    expect(asObject(nextParams(params("city=lahore"), { page: 3 }))).toEqual({
      city: "lahore",
      page: "3",
    });
  });

  it("keeps every filter while doing it", () => {
    expect(asObject(nextParams(params("city=lahore&plan=basic&page=2"), { page: 3 }))).toEqual({
      city: "lahore",
      plan: "basic",
      page: "3",
    });
  });

  it("spells page one as no page at all", () => {
    // So two links to the same first page are the same link, and a URL never
    // carries `page=1` for no reason.
    expect(asObject(nextParams(params("page=4"), { page: null }))).toEqual({});
  });

  it("can change a filter and the page in one call when a caller means to", () => {
    // The callout on the tenant list does exactly this: show the new owners
    // AND sort them to the top, in one navigation.
    expect(asObject(nextParams(params("page=5"), { origin: "converted", sort: "converted" }))).toEqual({
      origin: "converted",
      sort: "converted",
    });
  });
});
