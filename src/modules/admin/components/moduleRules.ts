import type { ModuleInfo } from "../services/adminService";

/**
 * What happens to the rest of the map when one switch moves.
 *
 * ── One copy, because there were two ────────────────────────────────────
 *
 * This rule lived in `AdminTenantCreatePage` and again in
 * `AdminTenantDetailPage`, and the two had already drifted: the create form
 * greyed a module out until its dependency was on, while the detail card did
 * the same but rendered it differently, and neither could switch a dependency
 * ON for you. Two copies of a rule is how the create screen and the edit screen
 * end up disagreeing about the same shop.
 *
 * ── Down is the server's rule; up is the admin's ────────────────────────
 *
 * `Modules::normalize` on the server only ever switches things OFF — a module
 * whose dependency is off cannot function, so it goes, and the stored map stays
 * honest. That must be mirrored here or an admin saves a map the server quietly
 * rewrites underneath them.
 *
 * Switching a dependency ON is the other direction, and it is deliberately NOT
 * a server rule: the server must never grant a shop something nobody chose. But
 * as an admin gesture it is exactly right — asking for Suppliers & Purchases
 * plainly means asking for the stock module it is built on, and the old screen
 * answered that by greying the row out and making the admin work out which of
 * eleven switches to find first.
 *
 * So: pressing a switch ON pulls its dependencies up with it, pressing one OFF
 * drops whatever stood on it — and both report what else moved, because a
 * switch that silently changes four others is the thing an admin cannot undo
 * from memory.
 */
export interface ModuleChange {
  /** The complete, settled map. */
  modules: Record<string, boolean>;
  /** Labels of modules this press also switched ON (never includes the press itself). */
  alsoOn: string[];
  /** Labels of modules this press also switched OFF. */
  alsoOff: string[];
}

/** Every key present as a boolean, so "absent" is never mistaken for "off by choice". */
function complete(catalog: readonly ModuleInfo[], from: Record<string, boolean>): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  catalog.forEach((m) => (map[m.key] = from[m.key] ?? false));

  return map;
}

/**
 * Settle a map the way the server will.
 *
 * Bounded by the number of modules: one pass can only ever switch something
 * off, so it cannot cycle. Selling online forces photos on — an online listing
 * with no picture is a listing nobody buys from, and `Tenant::imagesEnabled`
 * already treats it that way.
 */
export function settle(catalog: readonly ModuleInfo[], from: Record<string, boolean>): Record<string, boolean> {
  const map = complete(catalog, from);

  if (map.marketplace) map.images = true;

  let changed = true;
  while (changed) {
    changed = false;
    catalog.forEach((m) => {
      if (map[m.key] && m.depends.some((d) => !map[d])) {
        map[m.key] = false;
        changed = true;
      }
    });
  }

  return map;
}

export function applyModuleChange(
  catalog: readonly ModuleInfo[],
  current: Record<string, boolean>,
  key: string,
  on: boolean,
): ModuleChange {
  const before = complete(catalog, current);
  const map = { ...before, [key]: on };

  if (on) {
    // Pull the dependencies up FIRST. Settling first would switch the module
    // we just granted straight back off, which is what the old screens did —
    // except they never let the press happen at all.
    let changed = true;
    while (changed) {
      changed = false;
      catalog.forEach((m) => {
        if (!map[m.key]) return;
        m.depends.forEach((d) => {
          if (!map[d]) {
            map[d] = true;
            changed = true;
          }
        });
      });
    }
  }

  const settled = settle(catalog, map);

  const label = (k: string) => catalog.find((m) => m.key === k)?.label ?? k;
  const moved = (want: boolean) =>
    catalog
      .filter((m) => m.key !== key && settled[m.key] !== before[m.key] && settled[m.key] === want)
      .map((m) => label(m.key));

  return { modules: settled, alsoOn: moved(true), alsoOff: moved(false) };
}
