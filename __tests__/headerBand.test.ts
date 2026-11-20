import { fs, path, PROJECT_ROOT, codeOnly } from "./support/node";

/**
 * "THORA SA PRIMARY TOUCH B DO — LIKE TOP BANNER." Every screen's header is
 * the brand band (the customer app's teal top block): it runs under the status
 * bar, white ink, light status-bar glyphs. One component, so every screen
 * matches; the dashboard keeps it OUTSIDE its scroll so the band can reach up.
 */
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));

describe("the brand band on every screen", () => {
  const header = read("src/common/components/ScreenHeader.tsx");

  it("is painted in the brand colour, runs under the status bar, and lightens its glyphs", () => {
    expect(header).toMatch(/backgroundColor: c\.primary/);
    expect(header).toMatch(/marginTop: -insets\.top/);
    expect(header).toMatch(/<FocusedStatusBar background=\{c\.primary\} \/>/);
    expect(header).toMatch(/title: \{ \.\.\.typography\.title, color: c\.onPrimary \}/);
  });

  it("keeps its corner under half its height (Fabric draws half as a square)", () => {
    expect(header).toMatch(/borderBottomLeftRadius: 24/);
  });

  it("the dashboard's header sits outside the scroll", () => {
    const dash = read("src/modules/dashboard/screens/DashboardScreen.tsx");
    expect(dash.indexOf("<ScreenHeader")).toBeLessThan(dash.indexOf("<ScrollView"));
  });
});
