import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";

/**
 * WHAT THE APP CALLS, THE MANIFEST HAS TO DECLARE.
 *
 * ── The bug this exists for ──────────────────────────────────────────
 *
 * "on click add to cart getting error." `AddButton` ends with a
 * twelve-millisecond haptic tick, and `android.permission.VIBRATE` was not in
 * the manifest — so `Vibration.vibrate()` threw a SecurityException on Android
 * and took down the single gesture the whole app exists for. A garnish broke
 * the transaction.
 *
 * Nothing could have caught it earlier. TypeScript type-checks the call
 * perfectly, jest's mocks never reach the native module, and iOS does not need
 * the permission at all — so it worked on a simulator, worked in every test,
 * and failed on the first real Android device.
 *
 * ── Which is why the rule is a scan, not a note ──────────────────────
 *
 * Two halves, and the second is the one that keeps working when somebody adds
 * a native API this file has never heard of: every call is DECLARED, and every
 * call is GUARDED, so a permission that goes missing again degrades into a
 * missing tick rather than a crash.
 */

const ROOT = PROJECT_ROOT;
const MANIFEST = path.join(ROOT, "android/app/src/main/AndroidManifest.xml");

const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Native APIs this app calls, and the permission Android wants for each. */
const NEEDS: Array<{ api: RegExp; permission: string }> = [
  { api: /\bVibration\.vibrate\s*\(/, permission: "VIBRATE" },
  { api: /\bGeolocation\.(getCurrentPosition|watchPosition)\s*\(/, permission: "ACCESS_FINE_LOCATION" },
  { api: /\blaunchCamera\s*\(|\bCamera\b.*takePicture/, permission: "CAMERA" },
];

describe("every native call the app makes is declared", () => {
  const manifest = fs.readFileSync(MANIFEST, "utf8");
  const files = sourceFiles(path.join(ROOT, "src"));

  it("read a manifest with permissions in it", () => {
    // A count of findings is not evidence without a count of attempts: an
    // unreadable or renamed manifest would otherwise report a clean sweep.
    expect(files.length).toBeGreaterThan(30);
    expect(manifest).toMatch(/uses-permission/);
    expect(manifest).toMatch(/android\.permission\.INTERNET/);
  });

  it.each(NEEDS)("$permission", ({ api, permission }) => {
    const callers = files.filter((f) => api.test(codeOnly(fs.readFileSync(f, "utf8"))));
    if (callers.length === 0) return; // nothing calls it, nothing to declare

    expect(
      `${permission} called by ${callers.length} file(s), declared: ` +
        manifest.includes(`android.permission.${permission}`),
    ).toBe(`${permission} called by ${callers.length} file(s), declared: true`);
  });

  it("declares VIBRATE, because the add button ticks", () => {
    // Named rather than left to the loop above: this is the one that broke,
    // and a rule that only fires while a caller exists is a rule that
    // disappears the moment somebody refactors the caller into a helper.
    expect(manifest).toMatch(/android\.permission\.VIBRATE/);
  });
});

describe("a haptic can never be the reason a press fails", () => {
  const files = sourceFiles(path.join(ROOT, "src"));

  it("has one place that vibrates, and it swallows what vibrating throws", () => {
    const haptics = codeOnly(
      fs.readFileSync(path.join(ROOT, "src/common/ui/haptics.ts"), "utf8"),
    );
    expect(haptics).toMatch(/try\s*\{[\s\S]*Vibration\.vibrate/);
    expect(haptics).toMatch(/\}\s*catch/);
  });

  it("has no component calling the native module directly", () => {
    // The whole point: a bare `Vibration.vibrate()` anywhere else is a press
    // that can fail for a reason that has nothing to do with the press.
    const offenders = files
      .filter((f) => !f.endsWith("common/ui/haptics.ts"))
      .flatMap((f) =>
        codeOnly(fs.readFileSync(f, "utf8"))
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /\bVibration\.vibrate\s*\(/.test(line))
          .map(([n]) => `  ${path.relative(ROOT, f)}:${n}`),
      );

    expect(offenders.join("\n")).toBe("");
  });

  it("still ticks — the guard is a try, not a deletion", () => {
    const haptics = codeOnly(
      fs.readFileSync(path.join(ROOT, "src/common/ui/haptics.ts"), "utf8"),
    );
    expect(haptics).toMatch(/Vibration\.vibrate\(/);

    const users = files.filter((f) => /from "\.\/haptics"/.test(fs.readFileSync(f, "utf8")));
    expect(users.length).toBeGreaterThanOrEqual(2);
  });
});
