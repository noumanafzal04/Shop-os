import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";

/**
 * THE SHARED PACKAGE IS DECLARED IN THREE PLACES, AND THEY MUST AGREE.
 *
 * `@cartze/core` lives in a sibling folder and is consumed by ALIAS rather
 * than by `npm install` — no build step, no node_modules of its own, and one
 * copy of React because two copies in a bundle break hooks silently.
 *
 * The cost of that is three declarations of the same fact:
 *
 *   metro.config.js    what the BUNDLER resolves — the app on a phone
 *   jest.config.js     what the RUNNER resolves — every test
 *   tsconfig.json      what the COMPILER resolves — the editor and CI
 *
 * A mapping present in two of them is the dangerous state, because two of the
 * three keep working. It happened on the very first slice: `../core` imports
 * `react-native`, which resolves upward from ITS folder and never reaches
 * this app's copy — Metro was happy, jest was happy, and tsc reported
 * "Cannot find module 'react-native'".
 *
 * ── Why this reads config files as text ──────────────────────────────
 *
 * Requiring `metro.config.js` here would pull in `@react-native/metro-config`
 * and resolve a whole bundler in a unit test. The fact being checked is that
 * a declaration EXISTS in each file, which is text.
 *
 * The real proof that the alias works is elsewhere and is stronger: the
 * release APK's bundle contains hexes that exist only under `../core`.
 */
const read = (rel: string) => fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8");

/**
 * COMMENTS STRIPPED, and that was not a precaution.
 *
 * The first version of this file asserted `/watchFolders/` against the raw
 * text — and every one of these files DESCRIBES the mapping in a docblock
 * above it. Deleting `watchFolders: [core]` from the config left the word in
 * the comment, and the guard passed. A test that reads its own documentation
 * instead of the code is a test that can never fail.
 *
 * Caught by mutation, which is the only reason it is known.
 */
const metro = codeOnly(read("metro.config.js"));
const jestConfig = codeOnly(read("jest.config.js"));

/**
 * tsconfig is PARSED, not scanned — and `codeOnly` must not touch it.
 *
 * Two separate reasons, and the second is the interesting one:
 *
 *   · its own comments describe the mapping, so a raw text scan reads its
 *     documentation instead of its config — the same trap as above;
 *   · `codeOnly` strips block comments, and the path `"@cartze/core/*"`
 *     CONTAINS the opening sequence. Run over this file it opened a comment
 *     that never closed and swallowed the rest, so every assertion ran
 *     against a truncated string.
 *
 * Which is also why `tsconfig.json` is written with `//` comments only: a
 * one-line stripper is the whole JSONC support this needs, and the clever
 * version is the one that broke. Block comments there took the SUITE down —
 * reported, as ever, with the missing tests simply not counted.
 *
 * Parsing answers the actual question — what will the compiler resolve —
 * rather than what the file happens to say.
 */
const tsconfig = JSON.parse(
  read("tsconfig.json").replace(/^\s*\/\/[^\n]*$/gm, ""),
) as { compilerOptions: { paths: Record<string, string[]> } };

const paths = tsconfig.compilerOptions.paths;

describe("all three resolvers know about @cartze/core", () => {
  it("the bundler maps it", () => {
    expect(metro).toMatch(/['"]@cartze\/core['"]:/);
  });

  it("the bundler is allowed to READ it", () => {
    // `extraNodeModules` alone resolves the name and then Metro refuses to
    // serve a file outside the project. Both halves or neither.
    expect(metro).toMatch(/watchFolders:\s*\[/);
    expect(metro).toMatch(/path\.resolve\(__dirname, ['"]\.\.\/core['"]\)/);
  });

  it("the runner maps it — BOTH forms", () => {
    // Two entries, and a loose `/\^@cartze\/core/` matches either. Deleting the
    // deep one — the one every real import uses — then passed against the
    // bare one, which almost nothing imports. Caught by mutation.
    expect(jestConfig).toMatch(/'\^@cartze\/core\/\(\.\*\)\$'/);
    expect(jestConfig).toMatch(/'\^@cartze\/core\$'/);
  });

  it("the compiler maps it", () => {
    expect(paths["@cartze/core"]).toEqual(["../core/src/index.ts"]);
    expect(paths["@cartze/core/*"]).toEqual(["../core/src/*"]);
  });
});

describe("a file in core finds THIS app's react-native", () => {
  /**
   * The failure this prevents is not an error message — it is two copies of a
   * package in one bundle. For React that means hooks from two renderers,
   * which does not throw; it renders wrong.
   */
  it("the bundler sends bare specifiers back here", () => {
    expect(metro).toMatch(/new Proxy\(/);
    expect(metro).toMatch(/path\.join\(__dirname, ['"]node_modules['"], name\)/);
  });

  it("the runner does too", () => {
    expect(jestConfig).toMatch(/moduleDirectories/);
    expect(jestConfig).toMatch(/<rootDir>\/node_modules/);
  });

  it("maps react at its TYPES first, and the order is the point", () => {
    /**
     * Pointing `react` straight at `./node_modules/react` resolves to a JS
     * entry with no declarations. TypeScript does NOT then fall back to
     * `@types/react` — so every `import React` in the app becomes `any` and
     * JSX loses prop checking, silently. The types package has to come first.
     *
     * Both measured rather than reasoned about: the wrong order was tried,
     * the whole suite went red on implicit-any, and the order is why it is
     * green.
     *
     * react-native ships its own types, so one entry is enough there.
     */
    expect(paths.react).toEqual([
      "./node_modules/@types/react",
      "./node_modules/react",
    ]);
    expect(paths["react-native"]).toEqual(["./node_modules/react-native"]);
  });
});

describe("the package itself stays importable by two apps", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "../core/package.json"), "utf8"));

  it("keeps react and react-native as PEERS", () => {
    // A real dependency here would install a second copy under ../core, which
    // is the same two-renderers failure by a different route.
    expect(pkg.peerDependencies).toEqual({ react: "*", "react-native": "*" });
    expect(pkg.dependencies).toBeUndefined();
  });

  it("is private, because it is never published", () => {
    expect(pkg.private).toBe(true);
  });
});
