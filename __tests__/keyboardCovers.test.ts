import { PROJECT_ROOT, codeOnly, fs, path, sourceFiles } from "./support/node";

/**
 * "LOGIN MAIN, SIGNUP MAIN JB EMAIL YA PASSWORD PY CLICK KRTY TO WO KEYBOARD K
 * BACK MAIN ATA HAI — KEYBOARD BEHAVIOUR SET NI HAI KAHIN B … HR JGA."
 *
 * The shared KeyboardScreen handed Android to `adjustResize`. The app targets
 * SDK 36; from Android 15 every app is edge to edge and `adjustResize` no
 * longer shrinks the window, so the keyboard covered every form. Sheets (a
 * review, a price) had nothing at all, and two rider screens used a bare
 * ScrollView.
 *
 * The rule: a screen or sheet with a text field sits inside something that
 * moves for the keyboard — KeyboardScreen, a KeyboardAvoidingView with the
 * shared behaviour, or a BottomSheet (which now has one). Screens whose only
 * field is a search box at the TOP are listed: the keyboard cannot reach it.
 */
const ROOT = PROJECT_ROOT;
const CORE = path.join(ROOT, "..", "core", "src");
const read = (abs: string) => codeOnly(fs.readFileSync(abs, "utf8"));

/** A search field at the top of the screen; the list under it scrolls. */
const TOP_FIELD_ONLY = [
  "src/modules/marketplace/screens/BrowseScreen.tsx",
  "src/modules/marketplace/screens/LocationScreen.tsx",
  "src/modules/marketplace/screens/MarketScreen.tsx",
  "src/modules/marketplace/screens/MarketShopScreen.tsx",
  "src/modules/marketplace/screens/SearchScreen.tsx",
];

describe("the keyboard never covers a field", () => {
  it("KeyboardScreen pads on Android too, not only iOS", () => {
    const ks = read(path.join(CORE, "ui", "KeyboardScreen.tsx"));
    expect(ks).toMatch(/export const KEYBOARD_BEHAVIOR = "padding"/);
    expect(ks).toMatch(/behavior=\{KEYBOARD_BEHAVIOR\}/);
    expect(ks).not.toMatch(/Platform\.OS === "ios" \? "padding" : undefined/);
  });

  it("a BottomSheet lifts for the keyboard and may shrink to fit", () => {
    const bs = read(path.join(CORE, "ui", "BottomSheet.tsx"));
    expect(bs).toMatch(/<KeyboardAvoidingView style=\{styles\.root\} behavior=\{KEYBOARD_BEHAVIOR\}>/);
    expect(bs).toMatch(/panel: \{\s*flexShrink: 1/);
  });

  it("every screen and sheet with a text field moves for the keyboard", () => {
    const files = sourceFiles(path.join(ROOT, "src")).filter((f) => f.endsWith(".tsx"));
    const bare: string[] = [];
    for (const abs of files) {
      const rel = path.relative(ROOT, abs).split(/[\\/]/).join("/");
      if (rel.startsWith("src/common/ui/")) continue; // the primitives themselves
      if (TOP_FIELD_ONLY.includes(rel)) continue;
      const code = read(abs);
      if (!/<(AppTextInput|TextInput)\b/.test(code)) continue;
      const moves =
        /<KeyboardScreen\b/.test(code) ||
        /<AuthScreen\b/.test(code) ||
        /<BottomSheet\b/.test(code) ||
        /<KeyboardAvoidingView[^>]*behavior=\{KEYBOARD_BEHAVIOR\}/.test(code);
      if (!moves) bare.push(rel);
    }
    expect(bare).toEqual([]);
  });

  it("the top-field list names only screens that still exist and still have a field", () => {
    for (const rel of TOP_FIELD_ONLY) {
      const abs = path.join(ROOT, rel);
      expect(fs.existsSync(abs)).toBe(true);
      expect(read(abs)).toMatch(/<(AppTextInput|TextInput)\b/);
    }
  });
});
