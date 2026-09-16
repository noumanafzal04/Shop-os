/**
 * STUB — structure only.
 *
 * Two states and nothing in between:
 *
 *   not signed in  →  SignInScreen
 *   signed in      →  PartnerTabs, plus the pushed screens
 *
 * Pushed on top of the tabs: OrderDetail, ProductForm, Categories,
 * Collections, Hours, Profile, Notifications, Help.
 *
 * ── The splash waits for one thing ───────────────────────────────────
 *
 * Whether the signed-in user belongs to a tenant at all. A customer who
 * installs this by mistake must land on a page that says so, not on an
 * empty order queue — the customer app has the mirror of this for a
 * business account, and it took two attempts to get right there.
 */
