# The map

Laid out to mirror `mobile/` exactly — same folder names, same depth, same
naming. Not for tidiness: Phase 0 lifts `common/`, `theme/`, `stores/` and
the api layer out of `mobile/` into a shared package, and a file that sits
at the same path in both apps is a file that can be moved once instead of
reconciled twice.

```
partner/
├── README.md               what this app is, and is not
├── STRUCTURE.md            this file
├── docs/
│   └── DECISIONS.md        the four open questions
├── package.json            INTENT ONLY — nothing installed
├── app.json                display name
└── src/
    ├── App.tsx             providers, then the navigator
    │
    ├── common/             ← Phase 0 replaces this with the shared package
    │   ├── api/            axios client, retry/backoff, react-query
    │   ├── ui/             SafeScreen, ScreenHeader, SmartImage, Price…
    │   ├── hooks/          useDebouncedValue, usePullToRefresh
    │   └── utils/          keychain-backed prefs
    │
    ├── theme/              tokens + ThemeProvider (see DECISIONS #4)
    ├── stores/             zustand: auth, and which shop is open
    ├── navigation/         root stack + the five tabs
    ├── services/           push registration
    │
    └── modules/
        ├── auth/           sign in — any tenant user
        ├── today/          the landing tab: what needs doing now
        ├── orders/         THE module. List, detail, accept, stages
        ├── menu/           products, sold-out, one photo, categories
        ├── shop/           open/closed, delivery, hours, logo + banner
        ├── insights/       read-only numbers
        ├── account/        profile, password, notifications, help
        └── printing/       receipt + kitchen slip (see DECISIONS #2)
```

## Why these seven modules

The API already answers all of it — 67 tenant endpoints exist, and this
app is a new client rather than a new system. The split below is by what a
shopkeeper DOES, not by what the server offers.

| Module | Writes | Reads only |
|---|---|---|
| auth | — | who am I, what may I do, which shop |
| today | — | new orders, today's takings, what is waiting |
| orders | accept / reject / advance / assign a rider / cancel | the queue and its per-stage counts |
| menu | product add + edit, price, **sold-out**, one photo, categories, collections | stock |
| shop | open/closed, delivery on/off, fee, radius, prep time, hours, logo, banner | plan, which modules are on |
| insights | — | today / 7 days / 30 days, best sellers |
| account | name, password, notification settings | help, version |

**Mostly read-only was the instruction, and this is what it means in
practice**: four modules write nothing at all, and the two that do write
are the two a shopkeeper actually touches during a shift — an order's
stage, and whether an item is on today.

## Permissions, not roles

`GET /auth/me` already returns `permissions[]` and `tenant.features`. A tab
the signed-in person cannot use is never rendered — not disabled, not
shown-then-refused.

This codebase has a standing rule behind that: **cashier, waiter and
kitchen are permission SETS, not roles**, and a screen offered to somebody
who is then bounced out of it is a bug class that has been fixed here more
than once. `src/navigation/tabsFor.ts` is the one place that decides.

## What every module folder holds

```
modules/<name>/
├── screens/       one file per screen
├── components/    only what that module uses
├── hooks/         react-query wrappers
└── services/      the endpoints, typed
```

`today`, `insights` and `auth` have no `components/` or `hooks/` folder
yet — they will get one when something needs it. An empty folder is a
promise, and this repo already has a rule about promises implemented
nowhere.
