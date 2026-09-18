import { Share } from "react-native";

/**
 * WHERE A SLIP GOES — the axis this product already decided on.
 *
 * `shopos-hardware` states it: the abstraction is TRANSPORT, not vendor SDK.
 * A slip is text; where it goes is a separate question with more than one
 * answer, and each answer is a function with the same shape.
 *
 * ── Why Share is the one that exists ─────────────────────────────────
 *
 * Not because it is the best — a Bluetooth thermal printer is what a Pakistani
 * shop actually owns, and Share does not print. It is here first because:
 *
 *   it needs no hardware to verify, and shipping printer code that has never
 *   met a printer is shipping a guess;
 *   it is what shops already do — order details go to the kitchen, the rider
 *   and the customer over WhatsApp, today, without this app;
 *   Android's own print service cannot see a Bluetooth thermal printer at all,
 *   so it would be the option that looks like printing and is not.
 *
 * ── What adding Bluetooth costs later, and what it does not ──────────
 *
 * It costs a native module, runtime BLUETOOTH_CONNECT permission on Android 12+,
 * a pairing screen, and ESC/POS byte framing around this same text. It does
 * NOT cost a change to `slip.ts` — which is the whole point of splitting them,
 * and the reason the renderer emits fixed-width text rather than a view.
 */
export type Transport = (slip: string, title: string) => Promise<boolean>;

/**
 * The share sheet: WhatsApp, a note, a printer app, anything installed.
 *
 * Returns whether it was actually sent. `dismissedAction` is the person
 * changing their mind, which is not a failure and must not be reported as one.
 */
export const shareSlip: Transport = async (slip, title) => {
  try {
    const result = await Share.share({ message: slip, title });
    return result.action === Share.sharedAction;
  } catch {
    return false;
  }
};

/**
 * NOT BUILT. Listed so the seam is visible rather than remembered.
 *
 * `bluetoothSlip` — ESC/POS over RFCOMM to a paired 58/80mm printer. The text
 * from `slip.ts` goes out unchanged, wrapped in an init sequence and a cut.
 *
 * `printSlip` — Android's print service, which reaches a network or USB
 * printer and a PDF, and reaches a Bluetooth thermal printer never.
 */
export const TRANSPORTS_NOT_BUILT = ["bluetooth", "androidPrint"] as const;
