import { fs, path, PROJECT_ROOT } from "./node";

/**
 * THE SERVER'S ROUTES, AS FULL PATHS.
 *
 * ── Why this parser exists ───────────────────────────────────────────
 *
 * The first version of the endpoint guard checked each SEGMENT of a URL
 * separately: `/shop/dashboard` passed because the word "shop" appears
 * somewhere in the route file and so does "dashboard". It was blind to the
 * exact bug it had been written for — mutating `/dashboard` back to
 * `/shop/dashboard` left it green.
 *
 * A path is not its words. `routes/api.php` nests `Route::prefix(...)->group()`
 * several deep, so the only honest check is to REBUILD the full paths the way
 * Laravel does, which is what this does: a stack of prefixes, pushed when a
 * prefixed group opens and popped at the brace depth it opened on.
 */
export function serverRoutes(): string[] {
  const file = path.join(PROJECT_ROOT, "..", "backend", "routes", "api.php");
  if (!fs.existsSync(file)) return [];

  const src = fs
    .readFileSync(file, "utf8")
    // Comments carry example URLs and closing braces inside prose; both would
    // corrupt the depth count.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const found: string[] = [];
  /** prefix + the brace depth it was opened at. */
  const stack: Array<{ prefix: string; depth: number }> = [];
  let depth = 0;
  /**
   * A prefix seen but not yet opened.
   *
   * Groups are written across several lines —
   *
   *     Route::prefix('sales')
   *         ->middleware([...])
   *         ->group(function (): void {
   *
   * — so requiring `prefix` and `->group(` on ONE line silently dropped every
   * multi-line group. The symptom was absurd and nearly invisible: `sales`
   * never pushed, so its `Route::get('/{sale}')` was recorded as a TOP-LEVEL
   * `/{sale}`, and that pattern then matched any one-segment path anybody
   * cared to invent. The guard reported an endpoint called `/order-queue` as
   * real.
   */
  let pending: string | null = null;

  for (const line of src.split("\n")) {
    // A prefixed group opens on this line. Recorded BEFORE the depth is
    // updated, because the prefix belongs to everything inside the brace this
    // line opens.
    const prefix = line.match(/Route::prefix\(\s*['"]([^'"]+)['"]\s*\)/);
    const opensGroup = /->group\(/.test(line);

    // A route on this line, at the CURRENT prefix.
    const route = line.match(
      /Route::(get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]/,
    );
    if (route) {
      const tail = route[2].replace(/^\//, "");
      const base = stack.map((s) => s.prefix).join("/");
      found.push("/" + [base, tail].filter(Boolean).join("/"));
    }

    const opened = (line.match(/\{/g) ?? []).length;
    const closed = (line.match(/\}/g) ?? []).length;

    if (prefix) pending = prefix[1]!;
    if (opensGroup && pending !== null) {
      stack.push({ prefix: pending, depth });
      pending = null;
    }

    depth += opened - closed;

    // Pop every prefix whose group has now closed.
    while (stack.length > 0 && depth <= stack[stack.length - 1]!.depth) {
      stack.pop();
    }
  }

  /**
   * `v1` is dropped.
   *
   * The whole file sits inside `Route::prefix('v1')`, but the app's
   * `API_BASE_URL` already ends `/api/v1` — so a service asking for
   * `/dashboard` is asking for `/api/v1/dashboard`. Comparing the app's paths
   * against `/v1/...` would fail every one of them and the guard would be
   * useless in the loudest possible way, which is at least honest, but wrong.
   */
  return found.map((r) => r.replace(/^\/v1\//, "/"));
}

/**
 * Does the server have this path?
 *
 * `{id}` on either side matches any single segment, so the app's
 * `/orders/${id}/advance` matches the server's `/orders/{id}/advance`.
 */
export function hasRoute(routes: string[], url: string): boolean {
  const wanted = url.split("/").filter(Boolean);

  return routes.some((r) => {
    const parts = r.split("/").filter(Boolean);
    if (parts.length !== wanted.length) return false;

    return parts.every((p, i) => {
      const w = wanted[i]!;
      const isParam = (s: string) => s.startsWith("{") || s.startsWith("$") || s === "";
      return isParam(p) || isParam(w) ? true : p === w;
    });
  });
}
