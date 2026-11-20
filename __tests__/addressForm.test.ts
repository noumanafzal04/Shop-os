import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";
import {
  ADDRESS_MAX,
  canSave,
  composeAddress,
  customName,
  finalLabel,
  LABEL_MAX,
  labelKind,
  metresBetween,
  needsLookup,
  pinKey,
  SEP,
  splitAddress,
} from "../src/modules/account/addressForm";

/**
 * "ADDRESS SCREEN PY JA K CURRENT LOCATION B SELECT KR SKY, JB KRY USKA NAME
 * ADD KRY, OR SEARCH MAIN MAP SY SEARCH KRK MAZEED ADDRESS B ADD KR SKY."
 *
 * The old screen saved a typed line under whatever GPS said at that moment —
 * no map, so Home could only be saved while standing at home. These are the
 * rules behind the map screen that replaced it.
 */
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("one saved line: house details · street", () => {
  it("joins details and street, and splits them back exactly", () => {
    const line = composeAddress("House 12, 2nd floor", "Main Boulevard, Gulberg III, Lahore");
    expect(line).toBe(`House 12, 2nd floor${SEP}Main Boulevard, Gulberg III, Lahore`);
    expect(splitAddress(line)).toEqual({
      details: "House 12, 2nd floor",
      place: "Main Boulevard, Gulberg III, Lahore",
    });
  });

  it("keeps either half alone when the other is empty", () => {
    expect(composeAddress("", "Main Boulevard")).toBe("Main Boulevard");
    expect(composeAddress("House 5", null)).toBe("House 5");
    expect(composeAddress("  ", "  ")).toBe("");
  });

  it("an old address with no separator is all street", () => {
    expect(splitAddress("49 Saeed Street, Gulberg")).toEqual({ details: "", place: "49 Saeed Street, Gulberg" });
    expect(splitAddress(null)).toEqual({ details: "", place: "" });
  });

  it("a separator typed into the details cannot break the split", () => {
    const line = composeAddress("Flat 3 · Block B", "Johar Town");
    expect(splitAddress(line)).toEqual({ details: "Flat 3, Block B", place: "Johar Town" });
  });

  it("squeezes spaces and never exceeds what the server keeps", () => {
    expect(composeAddress("  House   7 ", " Model   Town ")).toBe(`House 7${SEP}Model Town`);
    expect(composeAddress("x".repeat(400), "y".repeat(400)).length).toBe(ADDRESS_MAX);
  });
});

describe("the name: Home, Work, or your own", () => {
  it("files a saved label under its chip, any case", () => {
    expect(labelKind("home")).toBe("Home");
    expect(labelKind("WORK")).toBe("Work");
    expect(labelKind("Office")).toBe("Work");
    expect(labelKind("Ammi's house")).toBe("Other");
    expect(labelKind("")).toBe("Other");
    expect(labelKind(null)).toBe("Other");
  });

  it("sends the chip's word, or the typed name for Other", () => {
    expect(finalLabel("Home", "ignored")).toBe("Home");
    expect(finalLabel("Other", "  Gym ")).toBe("Gym");
    expect(finalLabel("Other", "")).toBe("Other");
    expect(finalLabel("Other", "z".repeat(80)).length).toBe(LABEL_MAX);
  });

  it("shows a custom name back when editing, not 'Other' itself", () => {
    expect(customName("Gym")).toBe("Gym");
    expect(customName("Other")).toBe("");
    expect(customName("Home")).toBe("");
  });
});

describe("ready to save", () => {
  it("needs a pin and something to read", () => {
    expect(canSave({ lat: 31.5, lng: 74.3, place: "Gulberg", details: "" })).toBe(true);
    // No street found (no key / offline): the house line carries it.
    expect(canSave({ lat: 31.5, lng: 74.3, place: null, details: "House 9, Street 4" })).toBe(true);
    expect(canSave({ lat: 31.5, lng: 74.3, place: null, details: "  " })).toBe(false);
    expect(canSave({ lat: null, lng: 74.3, place: "Gulberg", details: "" })).toBe(false);
    expect(canSave({ lat: Number.NaN, lng: 74.3, place: "Gulberg", details: "" })).toBe(false);
  });
});

describe("one street lookup per place, not per nudge", () => {
  const a = { lat: 31.5204, lng: 74.3587 };

  it("asks the first time", () => {
    expect(needsLookup(null, a)).toBe(true);
  });

  it("does not ask again for a few metres' drift", () => {
    expect(needsLookup(a, { lat: 31.52045, lng: 74.35872 })).toBe(false);
  });

  it("asks again once the pin really moved", () => {
    expect(needsLookup(a, { lat: 31.5208, lng: 74.3587 })).toBe(true); // ~45 m north
  });

  it("measures distance in metres", () => {
    expect(Math.round(metresBetween(a, a))).toBe(0);
    const km = metresBetween({ lat: 31.5, lng: 74.3 }, { lat: 31.509, lng: 74.3 });
    expect(km).toBeGreaterThan(990);
    expect(km).toBeLessThan(1010);
  });

  it("remembers by an ~11 m key", () => {
    expect(pinKey(31.52041, 74.35871)).toBe(pinKey(31.52044, 74.35874));
    expect(pinKey(31.5204, 74.3587)).not.toBe(pinKey(31.5206, 74.3587));
  });
});

describe("the screens use it", () => {
  const pin = read("src/modules/account/screens/AddressPinScreen.tsx");
  const list = read("src/modules/account/screens/AddressesScreen.tsx");
  const loc = read("src/modules/marketplace/screens/LocationScreen.tsx");
  const nav = read("src/navigation/RootNavigator.tsx");

  it("the map screen is registered", () => {
    expect(nav).toMatch(/name="AddressPin" component=\{AddressPinScreen\}/);
  });

  it("the map screen looks the street up through the guard, and offers current location + search", () => {
    expect(pin).toMatch(/needsLookup\(asked\.current/);
    expect(pin).toMatch(/onRegionChangeComplete=\{onMoved\}/);
    expect(pin).toMatch(/accessibilityLabel="Use my current location"/);
    expect(pin).toMatch(/searchAddress\(/);
    expect(pin).toMatch(/finalLabel\(kind, custom\)/);
    expect(pin).toMatch(/composeAddress\(details, place\)/);
  });

  it("the list adds and edits on the map, and asks before removing", () => {
    expect(list).toMatch(/navigate\("AddressPin"\)/);
    expect(list).toMatch(/navigate\("AddressPin", \{ address: item \}\)/);
    expect(list).toMatch(/confirm\.ask\(/);
    // The old GPS-at-this-moment form is gone.
    expect(list).not.toMatch(/useLocationStore/);
  });

  it("Deliver to offers a new address on the map, and makes it the pin", () => {
    expect(loc).toMatch(/navigate\("AddressPin", \{ deliverHere: true \}\)/);
  });
});
