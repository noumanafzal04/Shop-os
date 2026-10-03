import { PROJECT_ROOT, codeOnly, fs, path, sourceFiles } from "./support/node";

/**
 * THE FOUR SCREENS THAT WERE PLANS, AND ARE NOW SCREENS.
 *
 * `screensAreReachable.test.ts` already says "a screen that exports a
 * component must be mounted" and "a stub is a plan, not a screen". Both still
 * hold. What neither can say is whether the PLAN was carried out — a file can
 * export a component, be mounted, and still not do the thing its docblock
 * promised.
 *
 * So this names the four by hand, and names what each one owed:
 *
 *   Profile         PUT /auth/profile, POST /auth/password/change
 *   Notifications   the in-app feed, with unread and mark-read
 *   Sales           the ledger, newest first, with one sale behind it
 *   Earnings        DELETED — see below
 *
 * ── Why Earnings is a deletion rather than a screen ──────────────────
 *
 * Its stub asked for `GET /reports/summary` over a period the shopkeeper
 * picks, with the revenue → cost → expenses → net chain. `MoneyScreen` had
 * been built in the meantime and does exactly that, with `PeriodBar`
 * offering every period the stub named including Pakistan's tax year.
 *
 * Building it would have been a second screen reading one endpoint and
 * disagreeing with the first the day either changed. A stub whose job has
 * been done elsewhere is deleted, not implemented.
 */

const src = (rel: string) => codeOnly(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8"));
const navigators = sourceFiles(path.join(PROJECT_ROOT, "src/navigation"))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

describe("no screen under src/ is still a comment-only stub", () => {
  it("finds the screens, or this proves nothing", () => {
    const screens = sourceFiles(path.join(PROJECT_ROOT, "src")).filter((f) =>
      /[/\\]screens[/\\][A-Za-z]+Screen\.tsx$/.test(f),
    );
    expect(screens.length).toBeGreaterThan(15);
  });

  it("exports a component from every screen file", () => {
    const stubs = sourceFiles(path.join(PROJECT_ROOT, "src"))
      .filter((f) => /[/\\]screens[/\\][A-Za-z]+Screen\.tsx$/.test(f))
      .filter((f) => !/export\s+function\s+\w+Screen\s*\(/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(PROJECT_ROOT, f));

    // Four of these were stubs when this app was handed over. A stub is an
    // honest thing while it is a plan; the app is no longer a plan.
    expect(stubs).toEqual([]);
  });
});

describe("Profile does what its plan said", () => {
  const s = src("src/modules/account/screens/ProfileScreen.tsx");
  const auth = src("src/modules/auth/services/authService.ts");

  it("calls both endpoints, not just the easy one", () => {
    expect(auth).toMatch(/apiPut<SessionUser>\("\/auth\/profile"/);
    expect(auth).toMatch(/apiPost<null>\("\/auth\/password\/change"/);
    expect(s).toMatch(/authService\.updateProfile\(/);
    expect(s).toMatch(/authService\.changePassword\(/);
  });

  it("sends null for a cleared field rather than an empty string", () => {
    // The server's rule is `nullable|email`. "" is not a valid email, so
    // clearing the box would fail validation complaining about the format of
    // something deliberately left blank.
    expect(s).toMatch(/email:\s*email\.trim\(\)\s*\|\|\s*null/);
    expect(s).toMatch(/phone:\s*phone\.trim\(\)\s*\|\|\s*null/);
  });

  it("warns BEFORE the button about what each save costs", () => {
    /**
     * Two consequences the server applies and the screen has to say first:
     * changing an email or phone clears its verified mark, and changing a
     * password logs every other session out — including the till, mid-shift.
     */
    expect(s).toMatch(/verified again/i);
    expect(s).toMatch(/signs you out everywhere else/i);
  });

  it("puts a field error on its field, not in a toast", () => {
    // "That email is already used by another account" over a three-box form
    // makes the person guess which box — and the server already said.
    expect(s).toMatch(/setFieldErrors\(/);
    expect(s).toMatch(/error=\{fieldErrors\.email\}/);
  });

  it("updates the STORE, so the rest of the app follows", () => {
    // The account page, the drawer header and the device name all read
    // `user.name`. A save that updates only this screen looks half-applied.
    expect(s).toMatch(/setUser\(res\.data\)/);
  });
});

describe("Notifications does what its plan said", () => {
  const s = src("src/modules/account/screens/NotificationsScreen.tsx");
  const hook = src("src/modules/notifications/hooks/useNotifications.ts");
  const service = src("src/modules/notifications/services/notificationService.ts");

  it("reads the feed and can mark one or all read", () => {
    expect(service).toMatch(/apiGet<AppNotification\[\]>\("\/notifications"/);
    expect(service).toMatch(/\/notifications\/\$\{id\}\/read/);
    expect(service).toMatch(/\/notifications\/read-all/);
  });

  it("takes the unread count from page ONE", () => {
    // Every page carries the same total. Taking it from whichever page
    // happened to load last would be the right number by luck.
    expect(hook).toMatch(/pages\?\.\[0\]\?\.meta\.unread_count/);
  });

  it("rolls the dot back when marking read fails", () => {
    // Optimistic without a rollback means "read" quietly comes to mean "the
    // request was sent".
    expect(hook).toMatch(/onMutate:/);
    expect(hook).toMatch(/onError:[\s\S]{0,160}setQueryData\(\["notifications"\], ctx\.previous\)/);
  });

  it("offers Mark all read only when it would do something", () => {
    expect(s).toMatch(/unread > 0 \? \(/);
  });

  it("marks unread with a shape as well as a colour", () => {
    // Colour alone is never an accessible cue, and a tinted card is the
    // first thing to vanish in bright sun.
    expect(s).toMatch(/s\.dot/);
    expect(s).toMatch(/accessibilityLabel=\{`\$\{item\.title\}\. \$\{unread \? "Unread" : "Read"\}`\}/);
  });
});

describe("Sales does what its plan said", () => {
  const list = src("src/modules/sales/screens/SalesScreen.tsx");
  const detail = src("src/modules/sales/screens/SaleDetailScreen.tsx");
  const service = src("src/modules/sales/services/salesService.ts");
  const hook = src("src/modules/sales/hooks/useSales.ts");

  it("reads the ledger and one sale behind it", () => {
    expect(service).toMatch(/apiGet<Sale\[\]>\("\/sales"/);
    expect(service).toMatch(/apiGet<Sale>\(`\/sales\/\$\{id\}`\)/);
  });

  it("is READ-ONLY, which is the design and not a gap", () => {
    /**
     * Cancelling, refunding and exchanging move stock and money in several
     * directions at once and need the whole picture — the drawer, the
     * batches, a customer's khata. That is the panel. A phone with a Refund
     * button and none of that context is a way to get it wrong quickly.
     */
    for (const file of [list, detail]) {
      expect(file).not.toMatch(/\/cancel/);
      expect(file).not.toMatch(/\/returns/);
      expect(file).not.toMatch(/apiPost/);
    }
    expect(service).not.toMatch(/apiPost|apiPut|apiDelete/);
  });

  it("stops paging on the SERVER's last page, not on a short one", () => {
    // A short page is also what a filter returning few rows looks like, and
    // a list that stops on that reading simply hides sales.
    expect(hook).toMatch(/p\.current_page < p\.last_page/);
  });

  it("leads with the number the CUSTOMER was given", () => {
    // A sale rung offline carries an `OFF-…` slip number and gets its
    // invoice number later on sync. The slip is the only number they saw.
    expect(list).toMatch(/sale\.offline_number \?\? sale\.invoice_number/);
    expect(detail).toMatch(/data\.offline_number \?\? data\.invoice_number/);
  });

  it("names the filter in its empty state", () => {
    // An empty list that cannot say why reads as a fact about the shop, and
    // there is no retry on a fact.
    expect(list).toMatch(/filtered \? "Nothing matches" : "No sales yet"/);
  });

  it("keeps one vocabulary for the codes", () => {
    // Two screens spelling `partially_refunded` their own way is one saying
    // "Part refund" and the other "Partially Refunded" about one sale.
    for (const file of [list, detail]) {
      expect(file).toMatch(/from "\.\.\/saleWords"/);
    }
  });
});

describe("Earnings was absorbed, not forgotten", () => {
  it("has no EarningsScreen file left behind", () => {
    expect(fs.existsSync(path.join(PROJECT_ROOT, "src/modules/money/screens/EarningsScreen.tsx"))).toBe(
      false,
    );
  });

  it("because MoneyScreen already answers everything it asked for", () => {
    const money = src("src/modules/money/screens/MoneyScreen.tsx");
    const bar = src("src/modules/money/components/PeriodBar.tsx");

    // The chain the stub specified: revenue − cost − expenses = what is left.
    expect(money).toMatch(/Cost of goods/);
    expect(money).toMatch(/Net profit/);
    // Over a period the shopkeeper picks, including PK's tax year — which
    // the stub named specifically, and is not a setting.
    expect(money).toMatch(/<PeriodBar/);
    expect(bar).toMatch(/tax_year/);
  });
});

describe("all four are reachable", () => {
  it("mounts every new screen", () => {
    for (const name of ["ProfileScreen", "NotificationsScreen", "SalesScreen", "SaleDetailScreen"]) {
      expect(new RegExp(`component=\\{${name}\\}`).test(navigators)).toBe(true);
    }
  });

  it("gives each one a control that opens it", () => {
    /**
     * Mounted is not reached. This product has shipped built-but-unreachable
     * pages more than once — the offline_selling admin screen, the reorder
     * list — and they are expensive precisely because nothing fails.
     */
    const account = src("src/modules/account/screens/AccountScreen.tsx");
    expect(account).toMatch(/nav\.navigate\("Profile"\)/);
    expect(account).toMatch(/nav\.navigate\("Notifications"\)/);

    const money = src("src/modules/money/screens/MoneyScreen.tsx");
    expect(money).toMatch(/nav\.navigate\("Sales"\)/);

    // The detail is reached from its own list, which is the only place it
    // makes sense from.
    expect(src("src/modules/sales/screens/SalesScreen.tsx")).toMatch(
      /nav\.navigate\("SaleDetail", \{ id: item\.id \}\)/,
    );
  });
});
