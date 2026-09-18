import { fs, path, PROJECT_ROOT } from "./support/node";

const root = PROJECT_ROOT;
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/**
 * Comments stripped before anything is asserted.
 *
 * The customer app's first version of this guard searched the raw file for
 * "watchFolders" — a word that also appears in the docblock explaining why
 * `watchFolders` is needed. Deleting the actual line kept the test green.
 *
 * `/* *\/` blocks are removed first, then `//` lines. tsconfig is NOT put
 * through this: it contains `"@cartze/core/*"`, and a naive block-comment
 * strip eats the file from that slash-star to the next star-slash. It is
 * parsed instead.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** tsconfig is JSONC — `//` lines only, by house rule, so this is enough. */
const tsconfig = () =>
  JSON.parse(read("tsconfig.json").replace(/^\s*\/\/.*$/gm, "")) as {
    compilerOptions: { baseUrl?: string; paths?: Record<string, string[]> };
  };

/**
 * `@cartze/core` IS CONSUMED BY ALIAS, IN THREE PLACES THAT MUST AGREE.
 *
 * Metro bundles it, Jest runs it, TypeScript checks it — and none of the three
 * reads the others' config. A mapping present in two of them compiles,
 * bundles, and then fails in the third at the worst possible moment.
 */
describe("the shared package is wired for all three tools", () => {
  it("lets Metro read outside this project and resolve the alias", () => {
    const metro = codeOnly(read("metro.config.js"));
    expect(metro).toMatch(/watchFolders/);
    expect(metro).toMatch(/['"]@cartze\/core['"]/);
  });

  it("sends bare imports from ../core back to THIS app's node_modules", () => {
    /**
     * Two copies of React in one bundle do not error — they break hooks, and
     * that reads as random re-render bugs rather than as a resolution problem.
     * With two apps now aliasing one folder, the proxy is also what stops them
     * borrowing each other's copies.
     */
    const metro = codeOnly(read("metro.config.js"));
    expect(metro).toMatch(/extraNodeModules/);
    expect(metro).toMatch(/node_modules/);
  });

  it("maps BOTH import forms for Jest", () => {
    /**
     * Both, and asserted separately. A single regex anchored at
     * `^@cartze/core` matches the deep form too, so the customer app once had
     * a guard that stayed green with the deep mapper deleted.
     */
    const jest = codeOnly(read("jest.config.js"));
    expect(jest).toContain("^@cartze/core/(.*)$");
    expect(jest).toContain("^@cartze/core$");
    expect(jest).toMatch(/moduleDirectories/);
  });

  it("maps both forms for TypeScript, with a baseUrl to hang them on", () => {
    const { compilerOptions } = tsconfig();
    expect(compilerOptions.baseUrl).toBeTruthy();
    expect(compilerOptions.paths?.["@cartze/core"]).toBeDefined();
    expect(compilerOptions.paths?.["@cartze/core/*"]).toBeDefined();
  });

  it("resolves react at its TYPES first, then the package", () => {
    /**
     * The order is the whole trick. Pointing straight at `./node_modules/react`
     * resolves to a JS entry with no declarations; TypeScript does NOT fall
     * back to `@types/react`, so every `import React` silently becomes `any`
     * and JSX loses its prop checking. Nothing fails — it just stops checking.
     */
    const react = tsconfig().compilerOptions.paths?.react ?? [];
    expect(react[0]).toMatch(/@types\/react$/);
    expect(react[1]).toMatch(/node_modules\/react$/);
  });

  it("puts @types first inside the wildcard, and puts the wildcard last", () => {
    const paths = tsconfig().compilerOptions.paths ?? {};
    const keys = Object.keys(paths);
    // Last, so the explicit entries above still win.
    expect(keys[keys.length - 1]).toBe("*");
    // @types first, the same lesson as `react` — `react-test-renderer` took a
    // whole test tree down the other way round.
    expect(paths["*"]?.[0]).toMatch(/@types/);
  });
});

/**
 * THE BOOT ORDER, WHICH NOTHING ELSE CATCHES.
 *
 * Deleting `configureApi({ baseUrl })` from the customer app broke no test, no
 * type check and no lint — the axios instance simply shipped with an empty
 * `baseURL` and every request went out as a relative path, which on a phone is
 * nowhere. Both calls are asserted here because at the time that one was
 * written there was only one of them.
 */
describe("the app configures the shared client before it is used", () => {
  const app = codeOnly(read("App.tsx"));

  it("hands the client its base URL", () => {
    expect(app).toMatch(/configureApi\(\s*\{\s*baseUrl/);
  });

  it("hands the client this app's session", () => {
    expect(app).toMatch(/wireAuthToApi\(\)/);
  });

  it("does both at module scope, not inside the component", () => {
    /**
     * A request made during the first render would find an unconfigured
     * client. "Before the component" is checked literally: both calls must
     * appear before the first `function` or `export default` in the file.
     */
    const firstComponent = app.search(/\n(export default )?function /);
    expect(firstComponent).toBeGreaterThan(0);
    expect(app.indexOf("configureApi(")).toBeLessThan(firstComponent);
    expect(app.indexOf("wireAuthToApi()")).toBeLessThan(firstComponent);
  });
});
