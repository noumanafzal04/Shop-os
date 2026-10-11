import type { NavItem, SubItem } from "./navItem";

/**
 * A PERSON'S SIMPLE VIEW — what is on it, and how they change that.
 *
 *     "simple view hoga usmain daily base py use hony waly menus according to
 *      permissions — ya wo khud add kr skty: simple menu setting icon on
 *      sidebar with toggle to add menu or sub menu in simple view"
 *
 * Simple used to be a second menu, written by hand beside the full one. Two
 * lists of the same screens is how they came to disagree: a restaurant's calm
 * view had the floor and no kitchen, and a screen added to one was forgotten
 * in the other. It is now the SAME menu with rows left out, so it cannot name
 * a screen the full view does not have, call it something else, or file it
 * under a different heading.
 *
 * Which rows: the ones marked `usual` — the day's work — until the person
 * says otherwise. What they say is kept as two short lists of DIFFERENCES,
 * never as "the menu I want":
 *
 *   add    screens they switched on that are not usual
 *   drop   usual screens they switched off
 *
 * A saved copy of the whole menu would freeze it on the day it was saved. The
 * shop buys Delivery a month later and the owner who once moved one row never
 * sees Riders appear; a screen that becomes part of everybody's day reaches
 * everyone except the people who had customised anything. Differences leave
 * the rest of the menu free to move.
 *
 * Everything here is arithmetic on a menu somebody else built — what the shop
 * was sold and what the person may open are decided before any of it runs, so
 * no choice stored on a device can show a screen the person may not have.
 */
export type SimpleChoice = { add: string[]; drop: string[] };

export const NO_CHOICE: SimpleChoice = { add: [], drop: [] };

/**
 * The dashboard is on every menu and cannot be switched off: it is where a
 * refused screen sends you, and a menu with nothing on it has no way back.
 */
export const ALWAYS_SHOWN = "/tenant";

/** Every screen a menu leads to, in the order it lists them. */
export function pathsOf(items: NavItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.path !== undefined ? [item.path] : []),
    ...(item.subItems ?? []).map((sub) => sub.path),
  ]);
}

/** The screens a Simple view starts with. */
export function usualPaths(full: NavItem[]): string[] {
  return full.flatMap((item) => [
    ...(item.path !== undefined && item.usual ? [item.path] : []),
    ...(item.subItems ?? []).filter((sub) => sub.usual).map((sub) => sub.path),
  ]);
}

/** What this person's Simple view shows, of the screens `full` offers. */
export function simplePaths(full: NavItem[], choice: SimpleChoice = NO_CHOICE): Set<string> {
  const offered = new Set(pathsOf(full));
  const shown = new Set([...usualPaths(full), ...choice.add].filter((path) => offered.has(path)));

  for (const path of choice.drop) shown.delete(path);
  if (offered.has(ALWAYS_SHOWN)) shown.add(ALWAYS_SHOWN);

  return shown;
}

/** The menu with everything but `keep` left out. A group left empty goes with its screens. */
export function keepOnly(full: NavItem[], keep: Set<string>): NavItem[] {
  return full
    .filter((item) => item.path === undefined || keep.has(item.path))
    .map((item) => (item.subItems
      ? { ...item, subItems: item.subItems.filter((sub) => keep.has(sub.path)) }
      : item))
    .filter((item) => item.path !== undefined || (item.subItems?.length ?? 0) > 0);
}

/**
 * A GROUP HOLDING ONE SCREEN IS THAT SCREEN.
 *
 * A dropdown with a single row is two presses to reach the only place it
 * goes. It happened wherever a menu was narrowed — by a module the shop does
 * not have ("Customers ▾ Customer list"), by a permission, and now by a
 * person's own choice — so it is settled once, for every menu, here.
 */
export function tidy(items: NavItem[]): NavItem[] {
  return items.map((item) => {
    if (item.path !== undefined || item.subItems?.length !== 1) return item;

    const only: SubItem = item.subItems[0];
    const { subItems: _gone, ...row } = item;

    return { ...row, name: only.home ? item.name : only.name, path: only.path };
  });
}

/**
 * The choice after `paths` are switched on or off.
 *
 * Kept normal: a screen whose switch agrees with the usual menu is in neither
 * list, so putting a row back by hand and pressing "back to the usual" leave
 * exactly the same thing behind — and a choice that changes nothing is empty.
 */
export function withSwitched(full: NavItem[], choice: SimpleChoice, paths: string[], on: boolean): SimpleChoice {
  const usual = new Set(usualPaths(full));
  const add = new Set(choice.add);
  const drop = new Set(choice.drop);

  for (const path of paths) {
    if (path === ALWAYS_SHOWN) continue;

    add.delete(path);
    drop.delete(path);
    if (on && !usual.has(path)) add.add(path);
    if (!on && usual.has(path)) drop.add(path);
  }

  return { add: [...add].sort(), drop: [...drop].sort() };
}

/** Has this person changed anything about the menu that is offered? */
export function isOwnChoice(full: NavItem[], choice: SimpleChoice): boolean {
  const offered = new Set(pathsOf(full));

  return [...choice.add, ...choice.drop].some((path) => offered.has(path));
}

/** Read whatever a device was holding, however old or mangled, as a choice. */
export function asChoice(held: unknown): SimpleChoice {
  const list = (value: unknown): string[] => (Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === "string" && v.startsWith("/tenant")))]
    : []);
  const from = (held !== null && typeof held === "object" ? held : {}) as { add?: unknown; drop?: unknown };

  return { add: list(from.add), drop: list(from.drop) };
}
