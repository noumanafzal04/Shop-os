import type { Branch } from "./services/branchService";

/**
 * THE BRANCH MENU, AS ROWS — what each one is called and what is said under it.
 *
 * The menu in the header was a list of names. Two of its rows said nothing
 * useful about themselves: "All branches — HQ" (what does choosing HQ do?) and
 * "Main — Main" (the default branch, tagged with its own name). And a shop
 * with two branches called "Saddar" and "Saddar 2" had no way to tell them
 * apart before choosing one.
 *
 * So each row has a name, a line under it, and at most one tag.
 */
export interface BranchRow {
  /** null is "All branches" — the head-office view. */
  id: string | null;
  name: string;
  /** What is said under the name: where it is, or what choosing it means. */
  note: string | null;
  tag: string | null;
}

export const ALL_BRANCHES: BranchRow = {
  id: null,
  name: "All branches",
  note: "Head office — every branch together",
  tag: null,
};

/** From this many branches the menu grows a box to find one in. */
export const FIND_FROM = 7;

export function branchRows(list: readonly Branch[]): BranchRow[] {
  return [
    ALL_BRANCHES,
    ...list.map((b) => ({
      id: b.id,
      name: b.name,
      note: b.city?.name ?? (b.address && b.address.trim() !== "" ? b.address.trim() : null),
      // One tag, and never the branch's own name back at it: the default
      // branch is usually CALLED "Main", and "Main — Main" says nothing.
      tag: !b.is_active ? "Closed" : b.is_default ? (/^main$/i.test(b.name.trim()) ? "Default" : "Main branch") : null,
    })),
  ];
}

/** The rows a typed word leaves. "All branches" stays while nothing is typed. */
export function findBranches(rows: readonly BranchRow[], typed: string): BranchRow[] {
  const q = typed.trim().toLowerCase();
  if (q === "") return [...rows];

  return rows.filter((r) => r.id !== null && (r.name.toLowerCase().includes(q) || (r.note ?? "").toLowerCase().includes(q)));
}

/** One step up or down a list that wraps. -1 (nothing lit) steps onto an end. */
export function step(at: number, count: number, by: 1 | -1): number {
  if (count === 0) return -1;
  if (at < 0) return by === 1 ? 0 : count - 1;

  return (at + by + count) % count;
}
