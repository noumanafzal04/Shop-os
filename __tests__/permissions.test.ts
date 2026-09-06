import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";

/**
 * WHAT THE APP CALLS, THE MANIFEST HAS TO DECLARE.
 *
 * ── The bug this exists for ──────────────────────────────────────────
 *
 * "on click add to cart getting error." `AddButton` ended with a
 * twelve-millisecond haptic tick, and `android.permission.VIBRATE` was not in
 * the manifest — so `Vibration.vibrate()` threw a SecurityException and took
 * down the single gesture the whole app exists for. A garnish broke the
 * transaction.
 *
 * Nothing could have caught it earlier. TypeScript type-checks the call
 * perfectly, jest's mocks never reach the native module, and iOS does not need
 * the permission at all — so it worked on a simulator, worked in every test,
 * and failed on the first real Android device.
 *
 * ── And the first fix was half wrong ─────────────────────────────────
 *
 * Declaring the permission was right. Wrapping the call in `try/catch` and
 * calling it safe was NOT: the failure arrives from the vibrator service
 * across a binder — `Parcel.createExceptionOrNull`, in the trace — and React
 * Native rethrows it on the native side. There is no JS frame for a `catch`
 * to sit in. "A haptic can never be the reason a press fails" was a claim the
 * language could not deliver.
 *
 * So the tick is gone. The add button already scales under a finger and swaps
 * to a tick mark, which is the feedback that was doing the work; twelve
 * milliseconds of buzz is not worth a permission, a binder call, and a class
 * of crash that only appears on a real device.
 *
 * ── What is left is the rule that generalises ────────────────────────
 *
 * Every native API this app calls is declared — and nothing is declared that
 * it does not call, because a permission asked for and unused is a question
 * on an install screen with no answer behind it.
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

  it("asks for nothing it does not use", () => {
    // The other direction, and the one the first fix got wrong. A permission
    // on the install screen is a question; asking it with nothing behind it
    // is how an app arrives looking like it wants more than it needs.
    const asked = [...manifest.matchAll(/android\.permission\.(\w+)/g)].map((m) => m[1]);
    expect(asked.length).toBeGreaterThan(2);

    const src = files.map((f) => codeOnly(fs.readFileSync(f, "utf8"))).join("\n");
    for (const { api, permission } of NEEDS) {
      if (asked.includes(permission) && !api.test(src)) {
        expect(`${permission}: asked for, called by nothing`).toBe(`${permission}: unused`);
      }
    }
  });
});

describe("nothing buzzes", () => {
  const files = sourceFiles(path.join(ROOT, "src"));

  it("makes no call the language cannot guard", () => {
    /**
     * `try/catch` around `Vibration.vibrate()` catches nothing.
     *
     * The failure comes back from the vibrator service across a binder —
     * `Parcel.createExceptionOrNull` sits in the middle of the trace — and
     * React Native rethrows it natively. There is no JS frame for a `catch`
     * to be in, which is why the first fix looked complete and crashed anyway.
     *
     * The add button already scales under a finger and swaps to a tick mark.
     * That is the feedback that was doing the work.
     */
    const offenders = files
      .flatMap((f) =>
        codeOnly(fs.readFileSync(f, "utf8"))
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /\bVibration\b/.test(line))
          .map(([n]) => `  ${path.relative(ROOT, f)}:${n}`),
      );

    expect(offenders.join("\n")).toBe("");
  });

  it("still answers a press, by moving rather than buzzing", () => {
    // The denominator: removing the buzz must not have removed the feedback.
    const btn = codeOnly(fs.readFileSync(path.join(ROOT, "src/common/ui/AddButton.tsx"), "utf8"));
    expect(btn).toMatch(/Animated\.spring/);
    expect(btn).toMatch(/<CheckIcon/);
  });
});
