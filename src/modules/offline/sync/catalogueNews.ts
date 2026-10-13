/**
 * IS A WRITE THIS DEVICE JUST MADE NEWS FOR ITS OWN CATALOGUE?
 *
 * The till keeps the shop's products, prices, offers, taxes, customers and
 * settings on the device, so it can sell with no line. When somebody at this
 * same device adds a product or corrects a price, that copy is behind — and
 * it used to stay behind until the quarter-hour heartbeat, a tab change or a
 * reload. Reloads no longer pull every time (`pullIsDue`), so without this
 * the gap would have grown.
 *
 * The rule is written as what is NOT news, on purpose. A list of the screens
 * that change the catalogue would be right today and miss the next one — and
 * the cost of missing is a till that cannot sell what its own owner just
 * made, where the cost of pulling once too often is one small request.
 *
 * What is not news:
 *
 *   /pos/…, /pos-devices   the till's own traffic: shifts, held bills, the
 *                          queue going up, the till announcing itself. The
 *                          pull makes some of these itself, and a pull that
 *                          counted as news would never stop.
 *   /sales…                ringing, returning, cancelling. A till sells all
 *                          day; a pull behind every bill is a request a
 *                          customer waits behind. Stock catches up on the
 *                          heartbeat, as it always has.
 *   /auth…, /notifications,  the session and the bell: about the person,
 *   /devices                 not the shelf.
 */
const NOT_NEWS = /^\/(pos|pos-devices|sales|auth|notifications|devices)(\/|\?|$)/;

export function isCatalogueNews(path: string): boolean {
  // The path as the caller wrote it; a full address is cut back to it.
  const at = path.indexOf("/api/v1");
  const local = at >= 0 ? path.slice(at + "/api/v1".length) : path;

  return !NOT_NEWS.test(local.startsWith("/") ? local : `/${local}`);
}

/**
 * How long after the last write the pull waits.
 *
 * Saving a product is often three writes — the product, its picture, its
 * packs — and an import is a run of them. Waiting for the run to end sends
 * one pull behind it instead of one per write.
 */
export const PULL_AFTER_A_WRITE_MS = 2_000;
