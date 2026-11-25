import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import { fs, path, PROJECT_ROOT } from "./support/node";

/**
 * THE SLIP REACHES PAPER — Bluetooth thermal (remembered), Wi-Fi/PDF, Share.
 *
 * The native half is this app's own `SlipPrinterModule.kt`; these tests hold
 * the JS half to the promises the sheet makes: a printer is remembered only
 * after it printed, "Nearby devices" refused is said in words, and a thermal
 * printer is never sent a character it cannot draw.
 */

const native = {
  pairedPrinters: jest.fn(),
  printBluetooth: jest.fn(),
  printSystem: jest.fn(),
  rememberPrinter: jest.fn(),
  forgetPrinter: jest.fn(),
  rememberedPrinter: jest.fn(),
};

beforeEach(() => {
  jest.resetModules();
  Object.values(native).forEach((f) => f.mockReset().mockResolvedValue(true));
  NativeModules.SlipPrinter = native;
  Platform.OS = "android";
  Object.defineProperty(Platform, "Version", { value: 34, configurable: true });
  jest.spyOn(PermissionsAndroid, "request").mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
});

const load = () => require("../src/modules/printing/printers") as typeof import("../src/modules/printing/printers");

describe("printing a slip", () => {
  const printer = { name: "BlueTherm 58", address: "00:11:22:33:44:55" };

  it("prints on the Bluetooth printer and remembers it for the next slip", async () => {
    await load().printOnBluetooth(printer, "Total ..... Rs 450");
    expect(native.printBluetooth).toHaveBeenCalledWith(printer.address, "Total ..... Rs 450");
    expect(native.rememberPrinter).toHaveBeenCalledWith(printer.address, "BlueTherm 58");
  });

  it("does not remember a printer that failed", async () => {
    native.printBluetooth.mockRejectedValue(new Error("Couldn't reach the printer. Is it on, paired and in range?"));
    await expect(load().printOnBluetooth(printer, "x")).rejects.toThrow("Couldn't reach the printer");
    expect(native.rememberPrinter).not.toHaveBeenCalled();
  });

  it("asks for Nearby devices first, and says so in words when refused", async () => {
    (PermissionsAndroid.request as jest.Mock).mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    await expect(load().printOnBluetooth(printer, "x")).rejects.toThrow("Allow Nearby devices");
    expect(native.printBluetooth).not.toHaveBeenCalled();
  });

  it("sends a thermal printer only characters it can draw", () => {
    const { toPrinterText } = load();
    expect(toPrinterText("Karahi × 2 — Full · spicy… ₨ 900")).toBe("Karahi x 2 - Full - spicy... Rs 900");
    expect(toPrinterText("a\nb")).toBe("a\nb");
    expect(toPrinterText("علی")).toBe("???");
  });

  it("is not offered where the module is not linked", () => {
    delete (NativeModules as Record<string, unknown>).SlipPrinter;
    expect(load().canPrint()).toBe(false);
  });

  it("is reachable from the order screen, both slips", () => {
    const screen = fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/orders/screens/OrderDetailScreen.tsx"), "utf8");
    expect(screen).toMatch(/<PrintSheet/);
    expect(screen).toMatch(/kitchen: slipFor === "kitchen"/);
    const app = fs.readFileSync(
      path.join(PROJECT_ROOT, "android/app/src/main/java/com/cartze/partner/MainApplication.kt"),
      "utf8",
    );
    expect(app).toMatch(/add\(SlipPrinterPackage\(\)\)/);
    const manifest = fs.readFileSync(path.join(PROJECT_ROOT, "android/app/src/main/AndroidManifest.xml"), "utf8");
    expect(manifest).toMatch(/android\.permission\.BLUETOOTH_CONNECT/);
  });
});
