import { describe, expect, it } from "vitest";
import { ADDRESS_HINT, canPulse, connectionMeans, type Connection, type DeviceKind } from "./connection";
import { canKick } from "../../common/escpos";

/**
 * Seven connections are offered and two of them do something. These hold the
 * words under the list to what the code can actually do.
 */

const CONNECTIONS: Connection[] = ["browser", "serial", "usb", "bluetooth", "lan", "wifi", "native"];
const KINDS: DeviceKind[] = ["receipt_printer", "label_printer", "barcode_scanner", "cash_drawer"];

describe("what a connection is said to do", () => {
  it("has something to say for every device and every connection on offer", () => {
    for (const kind of KINDS) {
      for (const connection of CONNECTIONS) {
        expect(connectionMeans(kind, connection).length, `${kind} over ${connection}`).toBeGreaterThan(30);
      }
    }
  });

  it("promises a drawer only where the till can really open one", () => {
    for (const connection of CONNECTIONS) {
      const words = connectionMeans("cash_drawer", connection);
      // The SAME answer the till uses when it tries to open the drawer.
      expect(canPulse(connection), connection).toBe(canKick(connection));
      if (canKick(connection)) {
        expect(words).toMatch(/opens this drawer/);
        expect(words).toMatch(/Chrome or Edge/);
        expect(words).toMatch(/not on an iPad/);
      } else {
        expect(words).toMatch(/cannot open a drawer/);
      }
    }
  });

  it("does not let Bluetooth, the network or Wi-Fi sound like the till connects to the printer", () => {
    for (const connection of ["bluetooth", "lan", "wifi", "native"] as const) {
      const words = connectionMeans("receipt_printer", connection);
      expect(words, connection).toMatch(/does not connect to the printer itself/);
      expect(words).toMatch(/print window/);
    }
  });

  it("says a printer works through the print window whatever is chosen", () => {
    for (const connection of CONNECTIONS) {
      expect(connectionMeans("receipt_printer", connection), connection).toMatch(/print window/);
    }
  });

  it("tells a shop a scanner needs nothing here", () => {
    expect(connectionMeans("barcode_scanner", "bluetooth")).toMatch(/like a keyboard/);
  });

  it("says what the address box is for", () => {
    expect(ADDRESS_HINT).toMatch(/does not connect/);
  });
});
