/**
 * WHAT A CONNECTION ACTUALLY DOES.
 *
 *     "hardwares ko b dekhna — jb connect ho skty"
 *
 * The device form offers seven connections: browser, serial, USB, Bluetooth,
 * network, Wi-Fi, built-in. A shopkeeper reads that list as seven ways the
 * till can reach a device, picks "Network (LAN)", types the printer's address
 * into the box beside it, and expects the till to print to it.
 *
 * The till is a web page. What it can do is two things:
 *
 *   PRINT   hand a page to the browser's print window. Whatever printer the
 *           computer itself can print to — over USB, Bluetooth, the network
 *           or Wi-Fi — is a printer the till can use, and the choice in this
 *           list changes nothing about that.
 *   PULSE   open a cash drawer over a serial line (Web Serial), which exists
 *           in Chrome and Edge on a computer and nowhere else. That is the
 *           one thing "Serial" and "USB" switch on.
 *
 * Nothing opens a socket to the address in the box, and nothing speaks
 * Bluetooth. So each choice says, under the list, what it will really do —
 * including when the answer is "nothing more than a note".
 */

export type DeviceKind = "receipt_printer" | "label_printer" | "barcode_scanner" | "cash_drawer" | "customer_display";
export type Connection = "browser" | "serial" | "usb" | "bluetooth" | "lan" | "wifi" | "native";

/** The connections the till can send a drawer pulse down. */
const DIRECT: readonly Connection[] = ["serial", "usb"];

export const canPulse = (connection: Connection): boolean => DIRECT.includes(connection);

/** One or two sentences, for the form, in the shop's words. */
export function connectionMeans(kind: DeviceKind, connection: Connection): string {
  if (kind === "barcode_scanner") {
    return "A scanner types into the till like a keyboard. There is nothing to connect here — plug it in or pair it with this computer, and scan.";
  }

  if (kind === "cash_drawer") {
    return canPulse(connection)
      ? "The till opens this drawer on a cash sale — in Chrome or Edge on a computer only, not on an iPad, iPhone or Android tablet. Save, then press Connect drawer once."
      : "The till cannot open a drawer over this connection. Open it by hand, or plug the drawer into the receipt printer and set that printer to Serial or USB.";
  }

  if (kind === "customer_display") {
    return "Nothing drives a customer display yet.";
  }

  // A printer.
  const prints = "Prints through this computer's print window, so any printer the computer can print to will work.";
  if (connection === "browser") return prints;
  if (canPulse(connection)) {
    return `${prints} A cash drawer plugged into it can also be opened from the till — Chrome or Edge on a computer only; press Connect drawer once after saving.`;
  }

  return `${prints} The till does not connect to the printer itself over this — it is recorded for your own reference, and a drawer cannot be opened through it.`;
}

/** What the address box is, honestly. */
export const ADDRESS_HINT = "For your own notes. The till does not connect to this address.";
