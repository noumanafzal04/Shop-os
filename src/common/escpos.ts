/**
 * Direct ESC/POS over Web Serial — the one thing a browser print dialog can
 * never do: open the cash drawer.
 *
 * In almost every shop the drawer is not a computer peripheral at all; it is a
 * box with a solenoid, plugged into the RJ11 socket on the back of the receipt
 * printer. It opens when the printer receives a pulse command. So "kick the
 * drawer" means "send ESC p to whatever the drawer hangs off" — the printer,
 * or the drawer itself if it has its own serial line.
 *
 * A browser cannot reach a serial port without permission, and permission can
 * only be requested from a user gesture. That shapes the whole flow:
 *   1. once per device, the cashier clicks "Connect drawer" → requestPort()
 *   2. after that the port is remembered, and getPorts() finds it silently on
 *      every later page load, so the kick needs no gesture at all
 *
 * Where the transport is `browser` (a plain print dialog) there is no kick and
 * the POS says so rather than pretending it opened.
 */

/** Whether this browser can talk to a serial port at all (Chrome/Edge, HTTPS). */
export function isSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

// Minimal shape of the Web Serial API — TS's DOM lib doesn't ship it yet, and
// we only touch the four members we actually use.
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(): Promise<SerialPortLike>;
}
const serial = (): SerialLike | null =>
  isSerialSupported() ? (navigator as unknown as { serial: SerialLike }).serial : null;

/** ESC p 0 25 250 — pulse drawer pin 2 (the near-universal kick). */
const KICK = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]);

let opened: SerialPortLike | null = null;

async function openPort(port: SerialPortLike, baudRate: number): Promise<SerialPortLike> {
  // Re-opening an already-open port throws; a port we opened stays open for
  // the life of the tab, so keep the one we have.
  if (opened === port) return port;
  await port.open({ baudRate });
  opened = port;
  return port;
}

/**
 * Ask the cashier to pick the printer/drawer port. Must be called from a click.
 * The grant is remembered by the browser per origin + device.
 */
export async function connectDrawer(baudRate = 9600): Promise<boolean> {
  const s = serial();
  if (!s) return false;
  const port = await s.requestPort();
  await openPort(port, baudRate);
  return true;
}

/** A port this origin was already granted, if any. No gesture needed. */
async function knownPort(): Promise<SerialPortLike | null> {
  const s = serial();
  if (!s) return null;
  if (opened) return opened;
  const ports = await s.getPorts();
  return ports[0] ?? null;
}

export type KickResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "not-connected" | "error"; message: string };

/**
 * Send the pulse. Never throws — a drawer that doesn't open must not take the
 * sale down with it, and the counter can always pull it by hand.
 */
export async function kickDrawer(baudRate = 9600): Promise<KickResult> {
  if (!isSerialSupported()) {
    return { ok: false, reason: "unsupported", message: "This browser can't reach the drawer directly. Use Chrome or Edge, or open it by hand." };
  }
  try {
    const port = await knownPort();
    if (!port) {
      return { ok: false, reason: "not-connected", message: "No drawer connected yet — connect it once in Settings → Hardware." };
    }
    await openPort(port, baudRate);
    const writer = port.writable?.getWriter();
    if (!writer) return { ok: false, reason: "error", message: "The drawer port is not writable." };
    try {
      await writer.write(KICK);
    } finally {
      writer.releaseLock();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Could not reach the drawer." };
  }
}

/** Transports we can actually pulse. Anything else is a print-dialog printer. */
export const DIRECT_TRANSPORTS = ["serial", "usb"] as const;

export function canKick(connectionType: string | null | undefined): boolean {
  return !!connectionType && (DIRECT_TRANSPORTS as readonly string[]).includes(connectionType);
}
