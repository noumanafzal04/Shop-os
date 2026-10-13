/**
 * WHO MAY DO WHAT WITH A DELIVERY — the buyer, and the person on the loading bay.
 *
 * The server has always drawn this line (`Permissions::READS_PURCHASE_ORDERS`,
 * `READS_SUPPLIERS`, and the routes under them): RAISING an order is buying;
 * RECEIVING one is stockroom work. "The goods are on the loading bay and the
 * person checking them off is the stock keeper, who is deliberately not a
 * buyer. Reading the order they are receiving against comes with it, or the
 * job is impossible."
 *
 * The menu followed it — a stock keeper is offered Purchase orders and
 * Suppliers. The two SCREENS did not: each opened on "No access" for anybody
 * without the buyer's own permission, so the job the server calls impossible
 * without reading the order was impossible, one press after the menu had
 * offered it. Found by hiring a stock keeper in a shop made by hand and
 * opening everything their menu showed.
 *
 * One answer now, read by both screens, and it is the server's:
 *
 *   to SEE orders, and RECEIVE       purchases.manage or inventory.manage
 *   to RAISE, PLACE, CANCEL          purchases.manage
 *   to SEE suppliers                 suppliers.manage, purchases.manage or inventory.manage
 *   to ADD, EDIT, DELETE a supplier  suppliers.manage
 *   to PAY a supplier                purchases.manage
 */
export interface PurchaseRights {
  seesOrders: boolean;
  receives: boolean;
  raises: boolean;
  seesSuppliers: boolean;
  editsSuppliers: boolean;
  paysSuppliers: boolean;
}

export function purchaseRights(can: (permission: string) => boolean): PurchaseRights {
  const buys = can("purchases.manage");
  const keepsStock = can("inventory.manage");
  const keepsTheBook = can("suppliers.manage");

  return {
    seesOrders: buys || keepsStock,
    receives: buys || keepsStock,
    raises: buys,
    seesSuppliers: keepsTheBook || buys || keepsStock,
    editsSuppliers: keepsTheBook,
    paysSuppliers: buys,
  };
}
