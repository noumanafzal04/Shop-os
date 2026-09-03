/**
 * WHICH MODULES EACH SHOP ROUTE STANDS ON — read out of App.tsx itself.
 *
 * ── Why this file exists ────────────────────────────────────────────────
 *
 * A module key has to land in three places at once: the registry, the route
 * gate, and whatever OFFERS the screen. Two of three is a button that bounces,
 * and the day Purchasing, Disposals, Stocktake, Labels, Customers, Promotions,
 * Bank offers, Documents and Kitchen each became a module of their own, four
 * surfaces were still asking the old parent key:
 *
 *   · Reports → Purchases      asked `inventory`, route wants `purchasing`
 *   · Reports → Bank claims    asked "does this shop sell", route wants `bank_offers`
 *   · Dashboard → Stock in     asked `inventory`, route wants `purchasing`
 *   · Dashboard → You owe      asked `inventory`, route wants `purchasing`
 *
 * The sidebar was correct, and had a test. The dashboard and the reports screen
 * offer screens too, and had none — which is the recurring shape here: a rule
 * applied to the loudest surface and not to its quieter siblings.
 *
 * ── Why it PARSES rather than restates ──────────────────────────────────
 *
 * A hand-written copy of the gates is a fourth place to update and a fourth
 * place to drift. This reads the gates that actually run. It is a lint rule
 * wearing a test's clothes and it cannot prove a guard works — `guards.tsx`
 * and the browser suite do that — only that no surface may offer a screen
 * whose gate asks for something the shop was not given.
 */

const SOURCES = import.meta.glob("../*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Comments out, code in — this file's own prose names the very gates it hunts
 * for, and so does App.tsx's. Block and JSX comments go whole; `//` counts only
 * at the start of a line.
 */
const stripComments = (src: string): string =>
  src
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

function appSource(): string {
  const key = Object.keys(SOURCES).find((k) => k.endsWith("/App.tsx"));

  if (!key) throw new Error("App.tsx not found — did it move?");

  return stripComments(SOURCES[key]);
}

/** `feature="x"` or `feature={["a", "b"]}` — a list means ANY of them will do. */
const OPENS = /^(\s*)<Route element=\{<RequireFeature feature=(?:"([^"]+)"|\{\[([^\]]+)\]\})\s*\/>\}>\s*$/;
const CLOSES = /^(\s*)<\/Route>\s*$/;
const PATH = /^\s*<Route\s+path="([^"]+)"/;

/**
 * One requirement: ANY of `anyOf` satisfies it. A route inside two nested
 * gates carries two requirements and must satisfy BOTH — /tenant/suppliers
 * sits inside `inventory` and then inside `purchasing`.
 */
export type Requirement = { anyOf: string[] };

/**
 * Every shop route App.tsx gates, mapped to what it stands on.
 *
 * Routes with no `RequireFeature` above them are absent, which is the honest
 * answer: they are open to every shop.
 */
export function routeFeatures(): Map<string, Requirement[]> {
  const out = new Map<string, Requirement[]>();
  const stack: Array<{ indent: number; anyOf: string[] }> = [];

  for (const line of appSource().split("\n")) {
    const open = OPENS.exec(line);

    if (open) {
      const single = open[2];
      const many = open[3];

      stack.push({
        indent: open[1].length,
        anyOf: single
          ? [single]
          : (many ?? "").split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
      });
      continue;
    }

    const close = CLOSES.exec(line);

    if (close) {
      // Only a `</Route>` sitting at the SAME indent as a gate's opening tag
      // closes that gate. Anything deeper is closing something inside it.
      if (stack.length > 0 && stack[stack.length - 1].indent === close[1].length) stack.pop();
      continue;
    }

    const path = PATH.exec(line);

    if (path && stack.length > 0) {
      const full = path[1].startsWith("/") ? path[1] : `/tenant/${path[1]}`;
      out.set(full, stack.map((s) => ({ anyOf: [...s.anyOf] })));
    }
  }

  return out;
}

/**
 * Would a shop with these modules be let into this path?
 *
 * An ungated path is reachable by everyone. A gated one needs every
 * requirement satisfied, and a requirement is satisfied by any one of its keys.
 */
export function routeIsOpen(
  features: Record<string, boolean>,
  path: string,
  gates: Map<string, Requirement[]> = routeFeatures(),
): boolean {
  const needs = gates.get(path);

  if (!needs) return true;

  return needs.every((n) => n.anyOf.some((f) => !!features[f]));
}
