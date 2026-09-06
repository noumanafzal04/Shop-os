import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";

/**
 * SIGNING OUT MEANS THE SAME THING WHEREVER IT IS PRESSED.
 *
 * There were two of them. The account screen called `useLogout`, which revokes
 * the server token and unregisters this device from push. The side menu called
 * `authStore.clear()` directly and did neither — so which button somebody
 * pressed decided whether their session was really over.
 *
 * A token left alive is a session anybody holding the phone can resume, and a
 * device left registered keeps buzzing about a shop its owner signed out of.
 *
 * This is a scanning guard rather than a rendered one on purpose: the defect
 * is a call site, and a second one added tomorrow is exactly the thing that
 * would slip past a test of the two screens that exist today.
 */

const ROOT = PROJECT_ROOT;

/** Source with its comments removed — prose about `clear()` is not a call. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("there is one way to sign out", () => {
  const files = sourceFiles(path.join(ROOT, "src"));

  it("scanned the app", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("nothing clears the session behind the hook's back", () => {
    // `useAuthStore(...).clear` / `getState().clear()` anywhere except the
    // store itself and the one hook that owns signing out.
    const owners = ["stores/authStore.ts", "modules/auth/hooks/useAuth.ts"];

    const offenders = files
      .filter((f) => !owners.some((o) => f.endsWith(o)))
      .flatMap((f) =>
        codeOnly(fs.readFileSync(f, "utf8"))
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          // Narrow on purpose: `s.clear` alone also matches the toast store's
          // own `clear`, which has nothing to do with sessions. A guard that
          // reports innocent code is a guard somebody silences.
          .filter(([, line]) =>
            /useAuthStore\(.*\bclear\b/.test(line) ||
            /useAuthStore\.getState\(\)\.clear\b/.test(line) ||
            /\bclearSession\b/.test(line),
          )
          .map(([n]) => `  ${path.relative(ROOT, f)}:${n}`),
      );

    expect(offenders.join("\n")).toBe("");
  });

  it("still recognises the mistake it was written for", () => {
    // The detector, checked against the line this guard exists because of.
    //
    // It earned its place immediately: the first pattern was
    // `useAuthStore\([^)]*\bclear\b`, and `[^)]*` stops at the ")" inside
    // "(s)" — so it could never reach the word `clear` that follows. The
    // scan above was passing by matching NOTHING, which is exactly the
    // failure a denominator check exists to catch.
    const was = 'const clearSession = useAuthStore((s) => s.clear);';
    expect(/useAuthStore\(.*\bclear\b/.test(was)).toBe(true);
    expect(/useAuthStore\(.*\bclear\b/.test('const s = useAuthStore((s) => s.status);')).toBe(false);
    expect(/\bclearSession\b/.test('clearSession().catch(() => {});')).toBe(true);
  });

  it("revokes the server token and drops this device from push", () => {
    const src = codeOnly(
      fs.readFileSync(path.join(ROOT, "src/modules/auth/hooks/useAuth.ts"), "utf8"),
    );

    // The three things signing out has to do, in the one place that does them.
    expect(src).toMatch(/mutationFn:\s*\(\)\s*=>\s*authService\.logout\(\)/);
    expect(src).toMatch(/await teardownPush\(\)/);
    expect(src).toMatch(/await clear\(\)/);
  });

  it("lands somewhere, rather than leaving the screen exactly as it was", () => {
    // Clearing the session leaves a GUEST, and a guest may browse the whole
    // app — so before this, signing out changed nothing on screen except the
    // name in the menu. It opens sign-in now.
    const src = codeOnly(
      fs.readFileSync(path.join(ROOT, "src/modules/auth/hooks/useAuth.ts"), "utf8"),
    );

    expect(src).toMatch(/navigationRef\.navigate\("SignIn"/);
    // AFTER the session is cleared, so the navigator has already swapped to
    // whatever a guest sees before this lands on top of it.
    expect(src.indexOf("await clear()")).toBeLessThan(src.indexOf('navigate("SignIn"'));
  });
});
