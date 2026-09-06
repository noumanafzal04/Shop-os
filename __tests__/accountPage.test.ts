import { PROJECT_ROOT, fs, path } from "./support/node";

/**
 * THE ACCOUNT TAB.
 *
 * ── The complaint ────────────────────────────────────────────────────
 *
 * "Account page option bht kam hai — securties, like this, or b bht kuch."
 * Three links, none of them about the account: no way to change a password
 * from the phone, no way to see which devices were signed in, and no way to
 * tell which version was installed when reporting a problem. All three had
 * server endpoints already — `/auth/password/change`, `/auth/sessions`,
 * Gradle's own `versionName`. The screens were the missing half.
 *
 * ── What is checked, and what is not ─────────────────────────────────
 *
 * Not "the page has N rows" — a count is satisfied by adding anything. The
 * rules here are the ones with a victim: a row that leads nowhere, a way out
 * that is not last, a screen offered but never registered.
 */

const ROOT = PROJECT_ROOT;

const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const account = codeOnly(
  fs.readFileSync(path.join(ROOT, "src/modules/account/screens/AccountScreen.tsx"), "utf8"),
);
const nav = codeOnly(fs.readFileSync(path.join(ROOT, "src/navigation/RootNavigator.tsx"), "utf8"));

describe("what the page offers", () => {
  it("offers security, and it is a real screen", () => {
    // The half that would be easy to ship alone: a row is a promise, and a
    // promise to a route nobody registered is a crash.
    expect(account).toMatch(/label: "Security"/);
    expect(account).toMatch(/route: "Security"/);
    expect(nav).toMatch(/<CustomerStack\.Screen name="Security" component=\{SecurityScreen\}/);
  });

  it("shows which version is installed", () => {
    // Read from `BRAND`, which `appVersion.test.ts` holds against Gradle's own
    // `versionName`. Typed in here it would be a number that agrees with
    // nothing and is quoted on every support call.
    expect(account).toMatch(/label="Version" value=\{BRAND\.version\}/);
  });

  it("puts the way out last, and nowhere else", () => {
    // "Logout on last py". It already was on this page — this is what keeps
    // it there when the next section is added underneath it.
    const body = account.slice(account.indexOf("<ScrollView"), account.indexOf("</ScrollView>"));
    const logout = body.indexOf("styles.signOut");

    expect(logout).toBeGreaterThan(-1);
    for (const marker of ['styles.section', 'styles.card', 'styles.tiles']) {
      expect(body.lastIndexOf(marker)).toBeLessThan(logout);
    }
  });

  it("leads a rider to the board and an applicant to the form", () => {
    // Where it goes follows what the SERVER decided, not what the row says.
    expect(account).toMatch(/riderStatus === "approved" \? "RiderHome" : "RiderApply"/);
  });
});

describe("a row that opens nothing does not wear a chevron", () => {
  it("has a separate component for a fact", () => {
    // The chevron IS the promise. Payment and Version have no screen behind
    // them, and giving them one would mean a page repeating six words.
    expect(account).toMatch(/function ValueRow\(/);
  });

  it("and that component draws no chevron", () => {
    const fn = account.slice(account.indexOf("function ValueRow("));
    const body = fn.slice(0, fn.indexOf("\nfunction "));
    expect(body).not.toMatch(/ChevronRight/);
    expect(body).toMatch(/styles\.rowValue/);
  });

  it("while the linking row still does", () => {
    // The denominator: if `Row` lost its chevron too, the check above would
    // pass by describing a page with no affordances at all.
    const fn = account.slice(account.indexOf("function Row("));
    expect(fn.slice(0, 1200)).toMatch(/ChevronRight/);
  });
});

describe("security screen", () => {
  const src = codeOnly(
    fs.readFileSync(path.join(ROOT, "src/modules/account/screens/SecurityScreen.tsx"), "utf8"),
  );

  it("says the password change will sign other devices out", () => {
    // The server does it either way. A person changing a password because
    // somebody else has it needs to know the other phone is being pushed out;
    // a person tidying up needs to know their tablet will ask again.
    expect(src).toMatch(/signs out every other device/i);
  });

  it("offers no sign-out button on the phone you are holding", () => {
    // It is the account page's Log out under a second name, and two words for
    // one action is how somebody presses the one that also means something
    // else.
    expect(src).toMatch(/\{!s\.is_current && \(/);
  });

  it("refuses a password the server would refuse", () => {
    // `min:8` and `different:current_password` are the server's rules, checked
    // here as WELL — sending a request certain to fail spends a connection to
    // say what the phone already knew.
    const ready = src.slice(src.indexOf("const ready ="));
    expect(ready.slice(0, 240)).toMatch(/next\.length >= 8/);
    expect(ready.slice(0, 240)).toMatch(/next !== current/);
    expect(ready.slice(0, 240)).toMatch(/next === confirmation/);
  });

  it("ends the local session when it ends every session", () => {
    // `/auth/logout-all` deletes this device's token too, so a screen that
    // called it and stayed put would leave the app holding a dead token and
    // blaming the network for every screen after it.
    expect(src).toMatch(/useLogoutEverywhere\(\)/);

    const hooks = codeOnly(
      fs.readFileSync(path.join(ROOT, "src/modules/auth/hooks/useAuth.ts"), "utf8"),
    );
    // …and it ends the session the same way the ordinary sign-out does.
    const everywhere = hooks.slice(hooks.indexOf("export function useLogoutEverywhere"));
    expect(everywhere.slice(0, 400)).toMatch(/onSettled: endSession/);
  });
});

/**
 * THE SIDE MENU'S PROFILE ROW.
 *
 * "sidebar user profile py edit icon ki bajaye arrow icon lagao." It carried a
 * pencil — "edit these details" — and pressing it opens the whole account
 * page: a profile, an avatar, a verified badge, a way out. Naming ONE of the
 * things a screen does is worse than naming none, because somebody looking for
 * their orders does not press "edit".
 */
describe("the profile row points at a page, not at a field", () => {
  const menu = fs
    .readFileSync(path.join(PROJECT_ROOT, "src/navigation/SideMenu.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("shows a chevron to somebody signed in", () => {
    expect(menu).toMatch(/signedIn \? \(\s*<ChevronRightIcon/);
    expect(menu).not.toMatch(/PencilIcon/);
  });

  it("still offers a guest the thing they need instead", () => {
    // The denominator: a chevron to a stranger points at a page that will ask
    // them to sign in anyway, so that half stays a button that says so.
    expect(menu).toMatch(/<Text style=\{styles\.editText\}>Sign in<\/Text>/);
  });
});
