import { PROJECT_ROOT, codeOnly, fs, git, path } from "./support/node";

/**
 * A KEY IN THIS REPO IS A KEY IN PUBLIC.
 *
 * ── Why this file exists ─────────────────────────────────────────────
 *
 * Two keys have already been through it. A working Geoapify key sat in
 * `config.ts` as a literal and is in git history to this day — rotating it is
 * the only fix. The comment above it said "set the key locally and do not
 * commit it", which is a rule that one `git add -A` defeats, and this repo
 * gets a lot of those.
 *
 * So the rule is mechanical now: the values live in `src/common/secrets.ts`,
 * which is gitignored, and `config.ts` imports them. This file is what keeps
 * that true — the guard, not the comment.
 *
 * ── What it cannot do ────────────────────────────────────────────────
 *
 * Nothing here stops the key being read out of a built APK. A bundled string
 * is extractable, and the ONLY real defence is provider-side: Google Cloud
 * application restrictions (Android package + release SHA-1) and an API
 * allow-list. This guard is about the repository.
 */
describe("api keys stay out of the repository", () => {
  it("keeps secrets.ts ignored by git", () => {
    // `check-ignore` exits 1 when the path is NOT ignored, which is the
    // failure this test exists for — so the throw is the assertion.
    expect(() => git(["check-ignore", "src/common/secrets.ts"])).not.toThrow();
  });

  it("has never tracked secrets.ts", () => {
    // Ignored is not the same as absent from the index: a file added before
    // the ignore rule stays tracked and keeps being committed.
    expect(git(["ls-files", "src/common/secrets.ts"])).toBe("");
  });

  it("ships an example so a fresh clone still bundles", () => {
    /**
     * `secrets.ts` is not in a clone, and `config.ts` imports it — which is a
     * build that fails on `npm install` with a missing module, for everyone,
     * forever. The example is tracked and `postinstall` copies it across when
     * the real file is absent.
     */
    const example = path.join(PROJECT_ROOT, "src/common/secrets.example.ts");
    expect(fs.existsSync(example)).toBe(true);
    expect(git(["ls-files", "src/common/secrets.example.ts"])).toBe(
      "src/common/secrets.example.ts",
    );

    const pkg = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts.postinstall).toContain("secrets.example.ts");
    expect(pkg.scripts.postinstall).toContain("secrets.ts");
  });

  it("leaves the example empty", () => {
    // The example is tracked, so anything in it is published. It carries the
    // SHAPE and nothing else.
    const src = fs.readFileSync(path.join(PROJECT_ROOT, "src/common/secrets.example.ts"), "utf8");

    for (const [, value] of src.matchAll(/=\s*"([^"]*)"/g)) {
      expect(value).toBe("");
    }
  });

  it("keeps every key out of the tracked source", () => {
    /**
     * The shapes of the two providers' keys, looked for across every tracked
     * file rather than only in `config.ts` — a key pasted into a service, a
     * test fixture or a doc is exactly as public.
     *
     * Google's are `AIza` plus 35 characters. Geoapify's are 32 hex
     * characters, which is also the shape of a UUID with the dashes taken out
     * and of half a dozen hashes, so that one is only looked for beside a word
     * that says what it is.
     */
    const tracked = git(["ls-files"])
      .split("\n")
      .filter((f: string) => /\.(ts|tsx|js|json|md|gradle|xml|ya?ml)$/.test(f));

    const offenders: string[] = [];

    for (const file of tracked) {
      const full = path.join(PROJECT_ROOT, file);
      if (!fs.existsSync(full)) continue;

      const src = codeOnly(fs.readFileSync(full, "utf8"));

      if (/AIza[0-9A-Za-z_-]{35}/.test(src)) offenders.push(`${file} (google)`);
      if (/(geoapify|apiKey|api_key)[^\n]{0,40}[0-9a-f]{32}/i.test(src)) {
        offenders.push(`${file} (geoapify)`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("makes config.ts read the keys rather than hold them", () => {
    const src = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/common/config.ts"), "utf8"),
    );

    expect(src).toMatch(/from "\.\/secrets"/);
    // Assigned from the import, never re-declared as a literal.
    expect(src).toMatch(/GOOGLE_MAPS_API_KEY = GOOGLE_MAPS_KEY/);
    expect(src).toMatch(/GEOAPIFY_API_KEY = GEOAPIFY_KEY/);
  });

  it("warns about the key the chosen provider actually uses", () => {
    /**
     * The old warning only ever checked Geoapify, so switching `MAPS_PROVIDER`
     * to google with an empty google key would have gone silent — the one
     * moment a "your key is empty" warning is for. Address search fails soft
     * (`geo.ts` returns null/[]), which is what makes silence expensive: the
     * app looks like it is working and finds nothing.
     */
    const src = codeOnly(
      fs.readFileSync(path.join(PROJECT_ROOT, "src/common/config.ts"), "utf8"),
    );

    expect(src).toMatch(
      /MAPS_PROVIDER === "google" \? GOOGLE_MAPS_API_KEY : GEOAPIFY_API_KEY/,
    );
  });
});
