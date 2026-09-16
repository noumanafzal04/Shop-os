/**
 * STUB — structure only.
 *
 * Email + password. Any tenant user may sign in; what they SEE is decided
 * by their permissions, not by a role — see `navigation/tabsFor.ts`.
 *
 *   POST /auth/login          → access + refresh tokens
 *   GET  /auth/me             → user, permissions[], tenant, tenant.features
 *
 * ── Three people can arrive here and only one should stay ────────────
 *
 *   a tenant user        → the tabs
 *   a customer           → "this app is for shops; here is the CartZe app"
 *   a platform admin     → the panel, in a browser
 *
 * The customer app has the mirror of this (`BusinessAccountScreen`) and it
 * was wrong twice: an account the rider endpoint had nothing to say about
 * sat on the splash for ever. Whatever else is unknown, this screen opens.
 */
