/**
 * STUB — structure only.
 *
 * Who is signed in, which shop they belong to, and what they may do.
 *
 * Same shape as `mobile/src/stores/authStore.ts` — tokens in the keychain,
 * never in plain storage — with one addition: the TENANT. The customer app
 * has no tenant; every screen here is scoped to one.
 *
 * ── A token lives one hour ───────────────────────────────────────────
 *
 * Access tokens expire an hour after minting, and the refresh is
 * single-flight in the api client. A shop leaves this app open all day, so
 * the refresh path matters more here than anywhere else.
 */
