/**
 * WHERE AN ITEM OR A CATEGORY IS SOLD (v2) — the panel's half of the server's
 * CatalogPlaces. The server decides; this only says the same thing first, so
 * the form shows what will happen before Save rather than after a refusal.
 *
 *   The owner — or someone the owner gave "Products at every branch" — lists
 *   an item at All branches or at the ones ticked. Everybody else lists at
 *   their own branch, and cannot change what is sold anywhere else.
 *
 *   A shop with one selling branch never sees any of it.
 */
export const ANY_BRANCH = "products.any_branch";

export interface SoldAt {
  all: boolean;
  ids: string[];
}

export interface Listed {
  all_branches?: boolean;
  places?: Array<{ id: string; name: string }>;
  /** A category says it by ids (the tree carries no names). */
  branch_ids?: string[];
}

/** Where a new item starts: the owner at All, everybody else at their own branch. */
export function soldAtForNew(isOwner: boolean, ownBranchId: string | null | undefined): SoldAt {
  return isOwner || !ownBranchId ? { all: true, ids: [] } : { all: false, ids: [ownBranchId] };
}

/** Where an item that exists is sold. Absent (an older server) reads as everywhere. */
export function soldAtOf(item: Listed | null | undefined): SoldAt {
  if (!item || item.all_branches !== false) return { all: true, ids: [] };

  return { all: false, ids: item.branch_ids ?? (item.places ?? []).map((p) => p.id) };
}

/** What the write sends: nothing when nobody touched the field, so the server's own rule stands. */
export function soldAtPayload(touched: SoldAt | null): { all_branches?: boolean; branch_ids?: string[] } {
  if (touched === null) return {};

  return touched.all ? { all_branches: true } : { all_branches: false, branch_ids: touched.ids };
}

/** May someone who cannot choose branches still change this? Only what is theirs alone. */
export function mayChangeAt(chooses: boolean, item: Listed | null | undefined, ownBranchId: string | null | undefined): boolean {
  if (chooses) return true;
  const at = soldAtOf(item);

  return !at.all && at.ids.length === 1 && at.ids[0] === ownBranchId;
}

/** "All branches", or the names ticked — for a list's badge. */
export function soldAtWords(at: SoldAt, names: ReadonlyMap<string, string>): string {
  if (at.all) return "All branches";
  const said = at.ids.map((id) => names.get(id)).filter((n): n is string => Boolean(n));

  return said.length > 0 ? said.join(", ") : "No branch";
}

/** Tick or untick one branch — the last one ticked stays: an item is sold somewhere. */
export function toggleBranch(at: SoldAt, id: string): SoldAt {
  if (at.ids.includes(id)) {
    return at.ids.length > 1 ? { all: false, ids: at.ids.filter((b) => b !== id) } : at;
  }

  return { all: false, ids: [...at.ids, id] };
}
