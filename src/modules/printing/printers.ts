import { NativeModules, PermissionsAndroid, Platform } from "react-native";

/**
 * THE PRINTERS — the native half is `SlipPrinterModule.kt`, this app's own.
 *
 * A Bluetooth thermal printer is what a counter owns, so it is the first
 * choice and the remembered one; the system print dialog covers a Wi-Fi/USB
 * printer and "Save as PDF"; Share stays for WhatsApp. Same `Transport` shape
 * as `shareSlip`, so the slip text never changes with where it goes.
 */

export interface Printer {
  name: string;
  address: string;
  looksLikePrinter?: boolean;
}

interface SlipPrinterNative {
  pairedPrinters(): Promise<Printer[]>;
  printBluetooth(address: string, text: string): Promise<boolean>;
  printSystem(text: string, jobName: string): Promise<boolean>;
  rememberPrinter(address: string, name: string): Promise<boolean>;
  forgetPrinter(): Promise<boolean>;
  rememberedPrinter(): Promise<Printer | null>;
}

const native = (): SlipPrinterNative | null =>
  Platform.OS === "android" ? ((NativeModules.SlipPrinter as SlipPrinterNative | undefined) ?? null) : null;

/** Printing exists on this build (Android, module linked). */
export const canPrint = (): boolean => native() !== null;

/**
 * WHAT A THERMAL PRINTER CAN DRAW.
 *
 * ESC/POS in its default code page has plain ASCII and little else; anything
 * outside it comes out as "?" — so the common typographic characters are
 * spelled out first. An Urdu name still prints as "?" — the slip's number
 * and phone are what the rider and kitchen go by.
 */
export function toPrinterText(slip: string): string {
  return slip
    .replace(/[—–]/g, "-")
    .replace(/[·•]/g, "-")
    .replace(/×/g, "x")
    .replace(/…/g, "...")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₨/g, "Rs")
    .replace(/[^\x0a\x20-\x7e]/g, "?");
}

/** Android 12+ asks for "Nearby devices" before any Bluetooth call. */
export async function allowBluetooth(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (Number(Platform.Version) < 31) return true;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

/** A refusal from the native side, in words a shopkeeper can act on. */
export function printerError(e: unknown): string {
  const message = (e as { message?: string } | null)?.message;
  return message && message.length < 120 ? message : "Couldn't print. Check the printer and try again.";
}

export async function pairedPrinters(): Promise<Printer[]> {
  const n = native();
  if (!n) return [];
  if (!(await allowBluetooth())) throw new Error("Allow Nearby devices for this app to reach the printer.");
  return n.pairedPrinters();
}

export async function printOnBluetooth(printer: Printer, slip: string): Promise<void> {
  const n = native();
  if (!n) throw new Error("Printing is not available on this phone.");
  if (!(await allowBluetooth())) throw new Error("Allow Nearby devices for this app to reach the printer.");
  await n.printBluetooth(printer.address, toPrinterText(slip));
  // Remembered only once it has actually printed — a wrong pick is not kept.
  await n.rememberPrinter(printer.address, printer.name);
}

export async function printOnSystem(slip: string, jobName: string): Promise<void> {
  const n = native();
  if (!n) throw new Error("Printing is not available on this phone.");
  await n.printSystem(slip, jobName);
}

export const rememberedPrinter = async (): Promise<Printer | null> => native()?.rememberedPrinter() ?? null;
export const forgetPrinter = async (): Promise<void> => {
  await native()?.forgetPrinter();
};
