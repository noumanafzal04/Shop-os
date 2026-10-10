import { describe, expect, it } from "vitest";

/**
 * EVERY SCREEN HAS A FIRST HEADING, AND IT IS THE SCREEN'S OWN NAME.
 *
 * The console's screens were each given one when they were walked A to Z.
 * The shop's forty-odd were not: every one titled itself with
 *
 *     <h2 className="text-xl font-semibold …">Customers</h2>
 *
 * — the right words in the right size, one level down, with nothing above
 * it. A page whose headings start at the second level is one a screen reader
 * lands on with no way to say where it is, and "jump to the first heading"
 * is how a person who cannot see the page finds out which page it is.
 *
 * They are `h1` now, with the same classes; nothing moved on screen. The
 * till, which has no title on it at all, has one that is read and not drawn.
 * This is what stops the next screen from starting at `h2` again.
 */
const PAGES = import.meta.glob(["../../modules/*/pages/*.tsx", "../../pages/**/*.tsx"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const PARTS = import.meta.glob(
  ["../../modules/admin/components/kit.tsx", "../../modules/hrm/components/NotBuiltYet.tsx", "../../modules/dashboard/components/DashboardHero.tsx", "../../modules/staff/StaffPage.tsx", "../../components/auth/SignInForm.tsx", "../../components/auth/SignUpForm.tsx"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** A page with no `<h1>` of its own may get it from one of these — each of which is checked to have one. */
const HEADED_BY: Record<string, string> = {
  PageHeader: "modules/admin/components/kit.tsx",
  NotBuiltYet: "modules/hrm/components/NotBuiltYet.tsx",
  DashboardHero: "modules/dashboard/components/DashboardHero.tsx",
  StaffPage: "modules/staff/StaffPage.tsx",
  SignInForm: "components/auth/SignInForm.tsx",
  SignUpForm: "components/auth/SignUpForm.tsx",
};

/** `file` → why it has no first heading and needs none. */
const NOT_A_SCREEN: Record<string, string> = {
  "modules/catalog/pages/ProductEditorRoute.tsx": "opens the item form as a dialog over the product list, which keeps the page's heading",
  "modules/catalog/pages/ProductFormPage.tsx": "a dialog over the product list — its title names the dialog (aria-labelledby); two first headings on one screen is what the browser walk caught",
  "pages/AuthPages/AuthPageLayout.tsx": "the frame round the sign-in and sign-up forms, each of which has its own",
  "pages/Dashboard/Home.tsx": "the template's demo dashboard — no route leads to it",
};

const short = (file: string) => file.replace(/^.*\/src\//, "").replace(/^(\.\.\/)+/, "");
const has = (source: string) => /<h1\b/.test(source);

describe("every screen has a first heading", () => {
  const pages = Object.entries(PAGES).filter(([file]) => !file.includes(".test.")).map(([file, source]) => ({ file: short(file), source }));

  it("is looking at the screens there are", () => {
    expect(pages.length).toBeGreaterThan(80);
  });

  it("the shared parts that supply one really have one", () => {
    const parts = Object.fromEntries(Object.entries(PARTS).map(([file, source]) => [short(file), source]));

    for (const [component, file] of Object.entries(HEADED_BY)) {
      expect(parts[file], `${file} was not found — ${component} cannot be checked`).toBeDefined();
      expect(has(parts[file]), `${component} is trusted to give a page its first heading and has none`).toBe(true);
    }
  });

  it("has one of its own, or is given one by a part that has", () => {
    const without = pages
      .filter((p) => !has(p.source))
      .filter((p) => !Object.keys(HEADED_BY).some((component) => new RegExp(`<${component}\\b`).test(p.source)))
      .filter((p) => !(p.file in NOT_A_SCREEN))
      .map((p) => p.file);

    expect(without, "these screens start below the first heading level — title them with <h1>").toEqual([]);
  });

  it("no screen titles itself one level down any more", () => {
    // The exact shape that was on forty-two screens: the page's name, styled
    // as its title, in an h2 — with no h1 anywhere in the file.
    const below = pages.filter((p) => !has(p.source) && /<h2 className="[^"]*text-xl font-semibold/.test(p.source)).map((p) => p.file);

    expect(below).toEqual([]);
  });

  it("the item form names itself as a dialog, since it is not a page", () => {
    const form = pages.find((p) => p.file === "modules/catalog/pages/ProductFormPage.tsx")!.source;

    expect(form).toMatch(/role="dialog"[\s\S]{0,80}aria-labelledby="item-form-title"/);
    expect(form).toMatch(/<h2 id="item-form-title"/);
  });

  it("every excuse is still a real file", () => {
    const stale = Object.keys(NOT_A_SCREEN).filter((file) => !pages.some((p) => p.file === file));

    expect(stale).toEqual([]);
  });
});
