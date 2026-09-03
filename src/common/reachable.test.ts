import { describe, expect, it } from "vitest";

/**
 * Is anything built, tested, and unreachable?
 *
 * ── The oldest shape in this codebase ───────────────────────────────────
 *
 * "A capability is not shipped until something a person touches can reach it"
 * has been written down here **eleven times**, each after somebody found it by
 * hand. The reorder list nobody could open. The offline-selling switch with no
 * admin screen. And the largest: the whole offline module — a barcode index, a
 * search, a category index, a stock-delta derivation — every piece built and
 * tested, and the POS screen wired to none of it. Offline, a till could not put
 * a single item in the cart, in any trade.
 *
 * Every one of those was findable mechanically, and this is the check:
 * **an export that its own test file is the only thing to use.** Tests prove a
 * thing works. They do not prove anybody can get to it.
 *
 * ── What it deliberately allows ─────────────────────────────────────────
 *
 * Helpers that exist FOR the tests — `reset…`, `forget…`, `clear…` — are the
 * honest exception: their whole job is to put a module back to a known state
 * between cases. They are listed by name rather than by prefix, so adding one
 * is a decision somebody writes down.
 *
 * ── A caution the first version of this earned ──────────────────────────
 *
 * It was written with `new RegExp(name, "g").test(text)` and reported real
 * callers as absent — **`RegExp.prototype.test` with a `/g` flag is stateful**,
 * advancing `lastIndex` between calls, so alternate lookups returned false. It
 * accused `flushVariances` of being unreachable while `pullNow` was calling it
 * directly. Counting matches with a fresh regex is what fixed it.
 *
 * An audit that produces findings is a thing to verify, not to believe.
 */

const SOURCES = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

/**
 * Comments out before counting.
 *
 * The first version of this counted them, and a file that MENTIONED a helper in
 * a comment looked like a file that called it — so removing the last real call
 * left the check green. A rule that a leftover sentence can satisfy is not a
 * rule.
 *
 * Imports are deliberately still counted: eslint already fails the build on an
 * unused one, so an import that survives is an import something uses.
 */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

/**
 * Stripped once per file, not once per lookup.
 *
 * The first version stripped inside the counter, which runs for every export
 * against every file — and the check went from milliseconds to a timeout.
 * Doing the expensive part once is the difference between a rule that runs on
 * every commit and one somebody switches off.
 */
const CODE = new Map(Object.entries(SOURCES).map(([path, text]) => [path, stripComments(text)]));

/** Fresh regex every time — see the caution above. */
const occurrences = (code: string, name: string): number =>
  (code.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;

/**
 * Exports whose only caller is a test, legitimately, with why.
 *
 * Keyed `file::export`. Every one of these exists so a test can put a module
 * back to a known state; none of them is a capability a shop is waiting for.
 */
const TEST_ONLY: Record<string, string> = {
  "modules/offline/db/open.ts::resetDbCache": "drops the memoised connection between cases",
  "modules/offline/db/repo.ts::clearCaches": "empties the stores between cases",
  "modules/offline/db/schema.ts::DURABLE_STORES": "the list a test asserts the schema against",
  "modules/offline/contact.ts::forgetServerContact": "resets the last-contact clock",
  "modules/offline/device/deviceId.ts::hasDeviceId": "asserted rather than called",
  "modules/offline/device/deviceId.ts::forgetDeviceId": "resets the stored id",
  "modules/offline/device/touch.ts::resetTouchClock": "resets the touch clock",
  "modules/offline/sync/applyPull.ts::resetCatalog": "wipes the cache between cases",
  "modules/offline/outbox/outbox.ts::readRow": "reads one row back to assert on it",
  // Moved here from NOT_SURFACED_YET on 2026-08-18, and the reclassification is
  // the interesting part. It waited for a manual "Sync now"; that control was
  // built, and the helper written to use it read a module variable React does
  // not subscribe to — it would have reported a stale answer for ever, so it
  // was deleted rather than shipped.
  //
  // What is left is genuine scaffolding: it exposes the single-flight slot so a
  // test can prove the slot is CLEARED when a pull fails. Without that, one
  // network blip wedges the till — every later pull hands back the same
  // rejected promise and it never tries again.
  //
  // An entry leaving NOT_SURFACED_YET is not automatically progress. Here the
  // thing it waited for was named, was built, and the honest answer was that it
  // still had no correct caller.
  "modules/offline/sync/pullNow.ts::isPulling": "exposes the single-flight slot so a test can prove it clears on failure",
  "test/routes.ts::TENANT_ROUTES": "the route list the contract tests are built from",
  // The module map each trade starts with, mirroring BusinessTypes on the
  // server. It lived inline in four nav test files and had to be edited in all
  // four — which is the shape of every guard-drift bug in this repo. One copy,
  // and it is a fixture rather than product code, so it lives beside routes.ts
  // for the same reason and is exempt for the same reason.
  "test/tradeFeatures.ts::TRADE_FEATURES": "the per-trade module map every nav guard is built from",
  "test/tradeFeatures.ts::EVERY_MODULE": "a shop with everything switched on — the shape reachability has to be measured against",
  "test/tradeFeatures.ts::MODULE_DEPENDS": "what each module stands on, mirroring Modules::all()",
  "test/tradeFeatures.ts::settleFeatures": "settles a module map the way the server stores it, so a matrix cannot invent impossible shops",
  // Reads the RequireFeature gates out of App.tsx so no surface can offer a
  // screen the shop cannot open. A fixture like routes.ts, and exempt for the
  // same reason: product code must not depend on a test's parser.
  "test/routeFeatures.ts::routeFeatures": "the route gates the offer-vs-reach guard is built from",
  "test/routeFeatures.ts::routeIsOpen": "asks those gates whether a shop would be let in",
  "test/routeFeatures.ts::Requirement": "the shape those gates are returned in",
  // Introspection over the permission map, so the tests can check it from BOTH
  // directions — a route with no rule, and a rule naming a route that no longer
  // exists. The file says so itself where `mappedScreens` is declared.
  "./routing/screenPermissions.ts::permissionForScreen": "map introspection for the coverage test",
  "./routing/screenPermissions.ts::mappedScreens": "map introspection for the coverage test",
};

/**
 * Designed, correct, and not surfaced yet — with the thing that would surface
 * it.
 *
 * A separate list from the one above on purpose. Those are test scaffolding and
 * always will be. **These are unshipped capability**, and the moment this list
 * grows past a handful it is telling you something: the product is accumulating
 * work nobody can use.
 *
 * Each line names what has to be BUILT for the entry to leave this list, so
 * "still exempt" can never quietly mean "still forgotten".
 */
const NOT_SURFACED_YET: Record<string, string> = {
  // `pillLabel` left this list when the till's pill was wired to it and the
  // flush learned to report progress. It had been exempt because "Sending X of
  // Y" was a state nothing tracked — and while it sat here the POS quietly grew
  // its own inline copy of the wording, which then drifted. An entry on this
  // list is not free.
  //
  // Tells an OFF- receipt from a real invoice number by its SHAPE.
  //
  // The sales ledger, its export and the command palette all surface the slip
  // number now — a customer holding one can be found and the row confirms it
  // back to them — but every one of those reads the `offline_number` FIELD,
  // which is either there or it is not. None of them has to recognise a string.
  //
  // Deliberately not given a contrived caller to empty this list: the only
  // honest use is telling what a PERSON TYPED from an invoice number, and
  // nothing needs to yet. Leaves this list when something has to decide from
  // the text alone — a scanner reading a slip barcode, or a search box that
  // wants to say "that looks like a slip number" when it finds nothing.
  "modules/offline/outbox/receiptNumber.ts::isOfflineNumber": "needs a caller that must judge a string, not read a field",
  // The fixed-width barcode. `LabelsPage` uses `code128BarsSvg` instead,
  // because a label is cut to a physical size and this variant "happily
  // renders 280px of bars into a 50mm sticker and spills over its
  // neighbours" — its own file says so.
  //
  // Kept rather than deleted on the file's own reasoning: it is rendered
  // through `dangerouslySetInnerHTML`, and its XSS escaping was written
  // BECAUSE it has no caller — "exactly the argument for escaping it now
  // rather than the day it gets one". Leaves this list when something sizes a
  // barcode by the symbol rather than by the label: a full-sheet print, or an
  // on-screen preview.
  "modules/catalog/utils/code128.ts::code128Svg": "needs a barcode sized by the symbol, not the label",
};

interface Unreachable {
  where: string;
  name: string;
}

const unreachable = (): Unreachable[] => {
  const found: Unreachable[] = [];

  for (const [path, text] of Object.entries(SOURCES)) {
    if (isTest(path)) continue;
    const where = path.replace(/^\.\.\//, "");
    const code = CODE.get(path) ?? "";

    const names = [
      ...text.matchAll(/^export (?:async )?function (\w+)|^export const (\w+)\s*[:=]|^export class (\w+)/gm),
    ]
      .map((m) => m[1] || m[2] || m[3])
      .filter((n): n is string => !!n);

    for (const name of names) {
      // Used inside its own file counts as reached.
      if (occurrences(code, name) > 1) continue;
      if (`${where}::${name}` in TEST_ONLY) continue;
      if (`${where}::${name}` in NOT_SURFACED_YET) continue;

      let app = 0;
      let tests = 0;
      for (const [other, otherCode] of CODE) {
        if (other === path || occurrences(otherCode, name) === 0) continue;
        if (isTest(other)) tests++;
        else app++;
      }

      // Untested AND unused is dead code, which is a different problem and not
      // this rule's business. What this catches is the thing that LOOKS
      // shipped: proved to work, and reachable by nobody.
      if (app === 0 && tests > 0) found.push({ where, name });
    }
  }

  return found;
};

describe("a capability is not shipped until something a person touches can reach it", () => {
  it("reads the whole app, so a silent zero cannot pass as a clean sweep", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(200);
  });

  it("catches an export whose only caller is its own test", () => {
    // Proves the check bites rather than trusting an empty result — and pins
    // the `/g` statefulness bug that made the first version of it lie.
    expect(occurrences("a foo b foo", "foo")).toBe(2);
    expect(occurrences("export function foo() {}", "foo")).toBe(1);
  });

  /**
   * 30s, not the default 5s.
   *
   * This scan is CPU-bound over every source file in the panel, and it went red
   * once inside the full 83-file suite while passing in 1.2 seconds on its own —
   * a loaded machine with parallel workers, not a real finding. A guard that
   * fails for reasons nobody can act on is a guard people learn to re-run
   * instead of read, and this file's own docblock is about exactly that.
   *
   * Still a ceiling, not a removal: 1.2s to 30s is twenty-five times the honest
   * cost, so a change that makes this pathological still shows up as red.
   */
  it("finds nothing built, tested and unreachable", () => {
    expect(unreachable().map((u) => `${u.where} → ${u.name}`)).toEqual([]);
  }, 30_000);
});
