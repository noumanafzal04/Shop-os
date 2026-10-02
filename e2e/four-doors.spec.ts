import { test, expect, type Page } from "@playwright/test";
import { assertSessionIsFresh } from "./api";

/**
 * FOUR DOORS, AND WHETHER A SHOPKEEPER CAN OPEN THEM.
 *
 * Every other spec here asks whether a screen is laid out correctly, or whether
 * one flow produces the right number. None of them asks the plainest question
 * there is: on the screen that manages a thing, can a person SEE the things,
 * ADD one, CHANGE one, and REMOVE one?
 *
 * It is the plainest question and the one this product has got wrong eight
 * separate times, always in the same shape — the API has the door, the screen
 * never knocks on it. The odometer field, the second tender at settle, the
 * settle refusal nobody printed, the module warning, `offline_days`,
 * `offline_selling`: none of those were missing features. Each was a working
 * endpoint with no control in front of it.
 *
 * ── WHY THIS IS A BROWSER TEST AND NOT A SCANNER ─────────────────────
 *
 * The obvious instrument is a script that matches route verbs against
 * `apiPost`/`apiPut`/`apiDelete` calls in the panel source. One was written.
 * It reported two findings and both were its own blindness: a tidy hook says
 *
 *     export function useStaffModule(basePath: string)
 *     apiPut(`${basePath}/${id}`, payload)
 *
 * and no text matcher can tell you what `basePath` is — it is a parameter, and
 * the same hook serves the shop's staff list and the admin console's. Every
 * well-factored module was invisible to it, which is most of them, so "two
 * walled-up doors" was a reassuring number measured against nothing. It was
 * deleted rather than kept and distrusted.
 *
 * A browser cannot be fooled that way. It sees the control or there is no
 * control.
 *
 * ── WHAT A PASS MEANS, AND WHAT IT DOES NOT ──────────────────────────
 *
 * A pass here means the control EXISTS and, for Add, that pressing it opens
 * something you can type into. It does not mean the save works — that is what
 * the rest of the suite is for. This is the floor, not the ceiling.
 *
 * A screen whose list is EMPTY cannot be asked about Edit or Remove: those live
 * on a row. That case is reported as UNJUDGED and counted, because a check that
 * quietly passes on an empty table is the "assert not-empty on an envelope"
 * mistake wearing a different hat.
 */

type Door = "add" | "edit" | "remove";

type Screen = {
  path: string;
  name: string;
  /** The doors this screen OWES a shopkeeper. */
  doors: Door[];
  /** Why a door is absent on purpose, when one is. */
  note?: string;
};

/**
 * Which doors each screen owes, stated per screen rather than as one blanket
 * rule — because the blanket rule is wrong. A sale is never deleted, it is
 * VOIDED, and a day's banking is closed, not removed. Demanding Delete
 * everywhere would produce a wall of false findings and the file would be
 * switched off within a week.
 */
const SCREENS: Screen[] = [
  { path: "/tenant/suppliers", name: "suppliers", doors: ["add", "edit", "remove"] },
  { path: "/tenant/customers", name: "customers", doors: ["add", "edit", "remove"] },
  { path: "/tenant/products", name: "catalog", doors: ["add", "edit", "remove"] },
  { path: "/tenant/categories", name: "categories", doors: ["add", "edit", "remove"] },
  { path: "/tenant/collections", name: "collections", doors: ["add", "edit", "remove"] },
  { path: "/tenant/staff", name: "staff", doors: ["add", "edit", "remove"] },
  { path: "/tenant/branches", name: "branches", doors: ["add", "edit", "remove"] },
  { path: "/tenant/expenses", name: "expenses", doors: ["add", "edit", "remove"] },
  { path: "/tenant/income", name: "other income", doors: ["add", "edit", "remove"] },
  { path: "/tenant/coupons", name: "coupons", doors: ["add", "edit", "remove"] },
  { path: "/tenant/promotions", name: "promotions", doors: ["add", "edit", "remove"] },
  { path: "/tenant/purchases", name: "purchase orders", doors: ["add"], note: "a received order is a record, not a row to delete" },
  { path: "/tenant/transfers", name: "branch transfers", doors: ["add"], note: "a dispatched transfer is history" },
  { path: "/tenant/stocktake", name: "stock counts", doors: ["add"], note: "an applied count is history" },
  // "add" here found a real gap and it is now a real control: the register
  // could only be filled by deleting a BATCH, so a shop that does not batch
  // its stock was handed a screen about its losses it could never put
  // anything on. See WriteOffStockAction.
  { path: "/tenant/disposals", name: "written-off stock", doors: ["add"], note: "a recorded write-off is history" },
  { path: "/tenant/riders", name: "riders", doors: ["add", "edit", "remove"] },
  { path: "/tenant/sales", name: "sales", doors: [], note: "a sale is voided, never edited or deleted" },

  // ── THREE SCREENS THIS LIST DOES NOT HOLD ───────────────────────────
  //
  // TILLS. Real rows with all four doors and no screen of their own:
  // `RegistersPanel` is mounted inside Shop Settings. The first version of
  // this list guessed `/tenant/registers`, got the 404 shell, and reported
  // "rendered no controls at all" as though a module were missing. A path
  // this file invents is a finding about this file.
  //
  // QUOTES & INVOICES and BANK OFFERS. Both were here and both PASSED, and
  // both were measuring the DASHBOARD — `documents` and `bank_offers` are off
  // for a mart, and `RequireFeature` navigates rather than refusing in place.
  // A false green, worse than the three false reds the first run produced,
  // and the reason every screen below now asserts it is still where it went.
  //
  // Neither can be fixed in the fixture: a module is assigned by the platform
  // and cannot be switched on from the tenant API — the wall `offline_selling`
  // already hits in shelf.setup.ts. Documents is walked by a retail shop in
  // trade.chrome.spec.ts; bank offers is reachable by NO fixture at all and is
  // recorded as a debt in everyScreenIsWalked.guard.ts.
];

/**
 * THE WORDS, NOT THE VERBS.
 *
 * The first run of this file failed three screens and every one of them was
 * this table being too narrow. Stocktake offers "+ Start a count" and
 * categories offer "Rename" — both are the door, spelled the way that screen's
 * subject is spoken about, which is RIGHT. A shop starts a count; it does not
 * "add" one. A category is renamed; "edit a category" means nothing.
 *
 * So the vocabulary has to be as wide as the product's own, or this file
 * reports its own narrowness as missing features — which is exactly what it
 * did, and exactly the kind of finding that gets a test switched off.
 *
 * Anchored at the start on purpose: an unanchored /add/ matches "Address" and
 * an unanchored /new/ matches "Renew".
 *
 * The obvious objection is that a list widened until everything passes proves
 * nothing. The guard against that is what goes IN: every word here is a verb
 * that MAKES something — add, start, raise, write off. "Export", "print",
 * "filter" and "settle" are all controls on these screens and none of them
 * belong, because none of them put a new row anywhere.
 */
const NAMES: Record<Door, RegExp> = {
  add: /^\s*[+＋]?\s*(add|new|create|start|raise|record|issue|enter|write)\b/i,
  edit: /^\s*(edit|rename|change|modify|manage|update)\b/i,
  remove: /^\s*(delete|remove|archive|discard)\b/i,
};

/**
 * Door-checks that could not be asked, because the list had no rows.
 *
 * Collected across the file and asserted at the end. An UNJUDGED line printed
 * to the console and never counted is a check that deleted itself quietly —
 * the same failure `skipReporter` exists for.
 */
const unjudgedAcrossTheRun: string[] = [];

/** Every control a person could press, with the words they would read on it. */
async function controls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    document
      .querySelectorAll<HTMLElement>('button, a[href], [role="button"], [role="menuitem"]')
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        if (getComputedStyle(el).visibility === "hidden") return;
        const name =
          el.getAttribute("aria-label") ??
          el.getAttribute("title") ??
          (el.textContent ?? "");
        const trimmed = name.replace(/\s+/g, " ").trim();
        if (trimmed) out.push(trimmed);
      });
    return out;
  });
}

/** How many rows the list is showing. Zero means Edit/Remove cannot be judged. */
async function rowCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bodies = Array.from(document.querySelectorAll("tbody"));
    let rows = 0;
    for (const b of bodies) rows += b.querySelectorAll("tr").length;
    if (rows > 0) {
      // An empty table still renders one row saying "Nothing here".
      const only = bodies[0]?.querySelectorAll("tr");
      if (rows === 1 && only && (only[0]?.querySelectorAll("td").length ?? 0) <= 1) return 0;
      return rows;
    }
    // Card lists, for the screens that do not use a table.
    return document.querySelectorAll("[data-row], [data-testid$='-row']").length;
  });
}

test.beforeEach(() => {
  assertSessionIsFresh();
});

for (const screen of SCREENS) {
  test(`${screen.name} — the doors a shopkeeper needs`, async ({ page }) => {
    await page.goto(screen.path);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(700);

    /**
     * STILL ON THE SCREEN IT ASKED FOR.
     *
     * `RequireFeature` and `RequirePermission` both `<Navigate to="/tenant">`
     * — they do not render a refusal in place. So a screen behind a module
     * this shop does not have silently becomes the DASHBOARD, and every
     * question below is answered about the dashboard instead. Bank offers
     * passed that way: the dashboard has a control beginning with "Add".
     *
     * Checked before anything else, because every other assertion in this
     * file is worthless once the page is somewhere else.
     */
    expect(
      new URL(page.url()).pathname,
      `${screen.name} did not stay on ${screen.path} — a guard redirected it, ` +
        `so everything below would describe a different screen`,
    ).toBe(screen.path);

    // THE DENOMINATOR. A screen that failed to render has no controls, and
    // "no Add button" would be a true sentence about a blank page.
    const visible = await controls(page);
    expect(visible.length, `${screen.name} (${screen.path}) rendered no controls at all`)
      .toBeGreaterThan(3);

    const rows = await rowCount(page);
    const missing: string[] = [];
    const unjudged: string[] = [];

    for (const door of screen.doors) {
      const found = visible.some((label) => NAMES[door].test(label));

      if (!found && door !== "add" && rows === 0) {
        // Row actions live on rows. With no rows, their absence proves nothing.
        unjudged.push(door);
        continue;
      }

      if (!found) missing.push(door);
    }

    // Add is the one door that can be pressed here cheaply, and the one whose
    // presence lies most readily: a button that opens nothing is not a door.
    if (screen.doors.includes("add") && !missing.includes("add")) {
      const button = page
        .locator('button, a[href], [role="button"]')
        .filter({ hasText: NAMES.add })
        .first();
      await button.click({ force: true }).catch(() => {});
      await page.waitForTimeout(900);
      const fields = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>("input, textarea, select")).filter(
            (el) => {
              const r = el.getBoundingClientRect();
              return r.width > 2 && r.height > 2 && (el as HTMLInputElement).type !== "hidden";
            },
          ).length,
      );
      // Two, not one: every one of these screens has a search box, which is an
      // input and is visible before anything is opened.
      if (fields < 2) missing.push("add opens nothing to type into");
    }

    for (const door of unjudged) {
      unjudgedAcrossTheRun.push(`${screen.name}: ${door}`);
    }

    expect(
      missing,
      `${screen.name} (${screen.path}) — no way to: ${missing.join(", ")}` +
        (screen.note ? `\n   (by design, this screen has no: ${screen.note})` : ""),
    ).toEqual([]);
  });
}

/**
 * THE LAST QUESTION: how much of this file did not run?
 *
 * Row actions need a row. A fixture that stops stocking one of these lists
 * turns its Edit and Remove checks into silence, and silence reads as a pass.
 * ZERO is the figure now. The debt when this was written was collections,
 * whose list the fixture never stocked — so the fixture stocks it, rather than
 * the allowance being raised to cover it. A new unjudged screen fails here
 * instead of disappearing into a console line nobody reads.
 */
test("every door was actually asked about", () => {
  expect(
    unjudgedAcrossTheRun,
    `these doors were never judged — the list was empty, so the check passed on nothing:\n   ` +
      unjudgedAcrossTheRun.join("\n   "),
  ).toHaveLength(0);
});
