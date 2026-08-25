/**
 * HOW LONG SOMEBODY HAS BEEN WAITING — said once, for every queue.
 *
 * This was written inline on the shop-requests screen as
 * `{days || "less than a"} day{days === 1 ? "" : "s"}`, which reads
 * "less than a days" on the only day most requests are ever looked at. Three
 * fragments deciding one sentence between them is how that happens; one
 * function returning the whole sentence is how it stops.
 *
 * It lives here rather than on either screen because there are now two queues
 * with the same discipline — shop requests and enquiries — and a phrase copied
 * into a second file is a phrase that gets fixed in one of them.
 */
export const daysWaiting = (iso: string): number =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export const howLong = (iso: string): string => {
  const days = daysWaiting(iso);
  if (days < 1) return "less than a day";

  return `${days} day${days === 1 ? "" : "s"}`;
};
