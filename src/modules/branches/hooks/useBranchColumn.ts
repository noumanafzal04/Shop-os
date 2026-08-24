import { useShopSettings } from "../../shop/hooks/useShop";
import { useBranches } from "./useBranches";

/**
 * SHOULD THIS LIST SAY WHICH BRANCH, AND WHAT IS IT CALLED?
 *
 * Four record screens store a branch and none of them showed it: expenses,
 * income, stock disposals and inventory movements. Their tables all carry
 * `branch_id`, the API returns it — and the panel's own row types did not
 * declare the field, so it arrived and was dropped. Exactly the shape that hid
 * a staff member's branch for as long as branches have existed.
 *
 * ── Why a hook rather than four copies of the rule ──────────────────────
 *
 * Because the rule is not "show a branch column". It is "show it only where
 * there is more than one branch to be at" — and that condition, written out
 * four times, is four chances for one of them to drift into showing a column
 * that reads "Main" all the way down for a single-site shop. The sidebar and
 * the permission map both learnt this the expensive way.
 *
 * Deliberately NOT applied to purchase orders or the cashbook. Neither table
 * has a branch column: a purchase order is raised for the shop, and the cashbook
 * is a derived view. Adding one there would claim something the record does not
 * hold, which is worse than not showing it.
 */
export function useBranchColumn() {
  const settings = useShopSettings();
  const multiBranch = settings.data ? settings.data.max_branches !== 1 : false;
  const branches = useBranches(multiBranch);
  const list = branches.data ?? [];

  return {
    /** Whether the column is worth a column at all. */
    show: multiBranch && list.length > 1,
    label: (id: string | null | undefined) => branchLabel(list, id),
  };
}

/**
 * What to print in the column.
 *
 * `null` reads as **Main**, because that is what the server does with an
 * unpinned row — not "—", which would suggest it happened nowhere.
 *
 * An id that is not in the list reads as **—**, and deliberately does NOT fall
 * back to "Main". A branch can be closed and removed while its records remain,
 * and printing the wrong branch's name against a record of money is worse than
 * printing nothing. The same holds mid-load, when the list is simply empty: a
 * page of confident wrong answers for one second is one second long enough for
 * somebody to read one.
 *
 * Exported so its test can drive the real thing. A test that restates the rule
 * proves the restatement.
 */
export function branchLabel(
  list: Array<{ id: string; name: string }>,
  id: string | null | undefined,
): string {
  if (id === null || id === undefined) return "Main";

  return list.find((b) => b.id === id)?.name ?? "—";
}
