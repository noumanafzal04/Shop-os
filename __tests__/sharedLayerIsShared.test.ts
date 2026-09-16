import { PROJECT_ROOT, codeOnly, fs, path, sourceFiles } from "./support/node";

/**
 * THE SHARED LAYER MAY NOT KNOW WHICH APP IT IS IN.
 *
 * ── What this is for ────────────────────────────────────────────────────
 *
 * A second app — CartZe Partner, the shopkeeper's — is built on this app's
 * theme, UI primitives, api client and prefs. Measured, that is about 6,800
 * of this app's ~26,000 lines.
 *
 * Copying them would mean every shared fix made twice, and this codebase has
 * already paid that bill once: the location-permission prompt existed in two
 * files, so one Android 12 bug — Allow with "Approximate" grants COARSE and
 * denies FINE — lived in both, and only one copy was ever fixed.
 *
 * So `common/` and `theme/` get extracted rather than copied. This guard is
 * the precondition: a file that reaches into `modules/`, `stores/`,
 * `navigation/` or `services/` cannot be lifted out, because the second app
 * has none of those.
 *
 * ── What it found when it was written ───────────────────────────────────
 *
 * Three files out of forty-six, and all three reached into `stores/`:
 *
 *   theme/ThemeProvider.tsx    → modeStore, to pick ember or leaf
 *   common/api/client.ts       → authStore, for tokens and the refresh
 *   common/ui/ModeSwitchCover  → modeStore, for the cover over a hat swap
 *
 * The first two were INVERTED rather than moved — the provider now takes
 * `paletteFor` and the client takes an `AuthAdapter`, and the app supplies
 * both. Each is a better boundary regardless of a second app: a theme
 * provider that knows about riders, and an HTTP layer that knows about a
 * customer's session, were both reaching past their own job.
 *
 * The third is not shared code at all — a mode is this app's idea — so it
 * moves into the app beside the store it reads.
 */
const OWNED_BY_THE_APP = ["src/modules", "src/stores", "src/navigation", "src/services"];

/** It has moved into the package; the rules it proves have not. */
const PROVIDER = path.join(PROJECT_ROOT, "../core/src/theme/ThemeProvider.tsx");

/**
 * Every file that is supposed to be liftable — the ones still here, and the
 * ones already lifted.
 *
 * `../core` is scanned too, and not as a formality: a file that has moved is
 * the one most likely to grow a reach back into the app, because whoever adds
 * the import is looking at a folder that no longer sits beside `stores/` and
 * has to type a package name to break the rule. Making it harder is not the
 * same as making it impossible.
 */
const shared = [
  ...sourceFiles(path.join(PROJECT_ROOT, "src/common")),
  ...sourceFiles(path.join(PROJECT_ROOT, "src/theme")),
  ...sourceFiles(path.join(PROJECT_ROOT, "../core/src")),
].map((abs) => path.relative(PROJECT_ROOT, abs));

/** Where a relative import actually lands, as a repo path. */
const resolveFrom = (file: string, spec: string): string =>
  path.normalize(path.join(path.dirname(file), spec));

describe("common/ and theme/ can be lifted out as they are", () => {
  it("found the files at all", () => {
    // The denominator. A walk that matched nothing would make the rule below
    // pass over an empty list, which is the way a sweep lies.
    expect(shared.length).toBeGreaterThanOrEqual(40);
  });

  it("reaches into nothing the second app will not have", () => {
    const offenders: string[] = [];

    for (const file of shared) {
      const code = codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, file), "utf8"));

      for (const m of code.matchAll(/from "(\.[^"]+)"/g)) {
        const target = resolveFrom(file, m[1]);
        if (OWNED_BY_THE_APP.some((dir) => target.startsWith(dir))) {
          offenders.push(`${file} → ${target}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("asked about real imports, not about comments", () => {
    // `codeOnly` strips them, and every one of the three violations this test
    // was written for is now DESCRIBED in a comment in the file it was fixed
    // in. Without stripping, the guard would fail on its own documentation.
    const provider = fs.readFileSync(PROVIDER, "utf8");
    expect(provider).toContain("modeStore");
    expect(codeOnly(provider)).not.toContain("modeStore");
  });
});

describe("the two inversions are real, not renamed", () => {
  it("lets the app choose the palette", () => {
    const provider = codeOnly(fs.readFileSync(PROVIDER, "utf8"));
    expect(provider).toMatch(/paletteFor\?: PaletteFor;/);
    // …and the hook that answers "the other side" no longer reaches for a
    // store of its own; the provider has already worked it out.
    expect(provider).toMatch(/return useTheme\(\)\.opposite;/);
  });

  it("lets the app supply the tokens", () => {
    const client = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "../core/src/api/client.ts"), "utf8"),
    );
    expect(client).toMatch(/export function configureAuth/);
    expect(client).toMatch(/accessToken: \(\) => string \| null;/);
    // …and which SERVER, for the same reason. That was the last import tying
    // the HTTP layer to one app's config.
    expect(client).toMatch(/export function configureApi/);
    expect(client).not.toMatch(/API_BASE_URL/);
  });

  it("hands the client its tokens as FUNCTIONS, not as values", () => {
    /**
     * The subtle half. An interceptor runs long after `configureAuth` was
     * called and must read the tokens AS THEY ARE THEN — handing over values
     * would freeze the session at boot, and every request after the first
     * silent refresh would carry a token the server has already replaced.
     *
     * Asserted on the shape rather than the wiring, because the wiring is one
     * line and the shape is the reason it works.
     */
    const store = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/stores/authStore.ts"), "utf8"),
    );
    expect(store).toMatch(/accessToken: \(\) => useAuthStore\.getState\(\)\.accessToken/);
    expect(store).not.toMatch(/accessToken: useAuthStore\.getState\(\)\.accessToken/);
  });

  it("wires BOTH before the first render, not in an effect", () => {
    /**
     * An effect runs AFTER the first render, and the first render is where a
     * query fires. A request that went out in between would go out
     * unauthenticated — this product has already had a sweep that asked as
     * nobody and reported ninety-six bugs that were not there.
     *
     * Both calls, and the second was missing from this guard: deleting
     * `configureApi` left the axios instance with an empty baseURL, so every
     * request in the app would resolve against a relative path. Nothing
     * failed — not tsc, not eslint, not eight hundred tests. Found by
     * mutation, which is the only reason it is here.
     */
    const app = codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, "App.tsx"), "utf8"));
    expect(app).toMatch(/^configureApi\(\{ baseUrl: API_BASE_URL \}\);$/m);
    expect(app).toMatch(/^wireAuthToApi\(\);$/m);
  });
});
