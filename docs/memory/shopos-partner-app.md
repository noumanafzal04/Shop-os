---
name: shopos-partner-app
description: "CartZe Partner (tenant app): scaffold done on branch tenant-partner-app, package com.cartze.partner; screens NOT started — wait to be told"
metadata:
  type: project
---

CartZe Partner is the tenant/shopkeeper app. Branch `tenant-partner-app`,
separate working copy at `partner/`.

**Standing instruction (2026-09-17): do NOT start building screens until the
user says so.** The scaffold is finished and parked deliberately.

| Done | Not done |
|---|---|
| 46-file structure map, RN 0.86 native project, `com.cartze.partner` | every screen — all 46 files are still comment-only |
| deps installed at versions IDENTICAL to `mobile/` | App.tsx, authStore, tabs, dashboard |
| `@cartze/core` wired in all three places, **proven** — partner `tsc` resolves a core import | |

**Why the screens are held:** the user's requirement is quality, not speed —
"achi screen chahiye, achy details, readability achi ho tenant ke liye". A
shopkeeper reads this mid-shift, one-handed, on a cheap phone in a bright shop;
it is not the customer app with different data. Dense numbers, generous type,
no decoration that costs a tap.

**How to apply:** Phase 1 is App.tsx + providers, authStore + SignInScreen,
`tabsFor` + the five tabs (Dashboard · Orders · Menu · Money · Account),
DashboardScreen + charts, AccountScreen. `tabsFor.ts` is ONE map read by both
the tab bar and the navigator — this codebase has the scar of four guards
reading one route list.

Partner will need its OWN Android app inside Firebase project `cartze-38808`,
because a Firebase app is keyed by package name. Not created yet.

See [[shopos-ride-palette]], [[shopos-keys-out-of-the-repo]].
