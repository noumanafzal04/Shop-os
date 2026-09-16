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
        ├── dashboard/      the landing tab: today, charts, pipeline
        ├── orders/         the queue. List, detail, accept, stages
        ├── menu/           products, sold-out, one photo, categories
        ├── money/          earnings, sales, commission, expenses
        ├── shop/           open/closed, delivery, hours, logo + banner
        ├── account/        profile, password, notifications, help
        └── printing/       receipt + kitchen slip (see DECISIONS #2)
```

## Why these eight modules

The API already answers all of it — 67 tenant endpoints, and this app is a
new client rather than a new system. The split is by what a shopkeeper
DOES, not by what the server offers.

| Module | Writes | Reads only |
|---|---|---|
| auth | — | who am I, what may I do, which shop |
| dashboard | shop open / closed | today's money, 7-day chart, pipeline, highlights |
| orders | accept / reject / advance / assign a rider / cancel | the queue and its per-stage counts |
| menu | product add + edit, price, **sold-out**, one photo, categories, collections | stock |
| money | record an expense | earnings per period, sales, commission, margins |
| shop | open/closed, delivery, fee, radius, prep time, hours, logo, banner | plan, which modules are on |
| account | name, password, notification settings | help, version |

Three modules write, and each writes exactly one kind of thing a
shopkeeper does from a phone: move an order along, turn an item off,
write down what was spent. Everything else is read.

## The correction that produced this list

The first version of this file had an `insights` module described as
"deliberately thin — a phone is where somebody glances between
customers". That was written for a shop whose real books live in the
panel, and it is wrong for the shop this app is FOR.

An online-only business has no counter and no panel habit. This app is the
business: what came in today, what is still owed, what the platform took,
what is left. So the numbers are a TAB, not a footnote — and they cost
almost nothing to build, because the server already answers all of it:

| already returns | powers |
|---|---|
| `GET /dashboard` → `today` + `deltas` | the tiles, with yesterday's comparison |
| `GET /dashboard` → `sales_series` | the 7-day line — zero-filled by the server |
| `GET /dashboard` → `expense_breakdown` | the donut |
| `GET /dashboard` → `order_pipeline`, `highlights`, `money_owed` | the rest of the landing tab |
| `GET /reports/summary?period=…` | earnings over day / week / month / year / **PK tax year** / custom |
| `GET /sales`, `/sales/{id}` | every sale, and its invoice |
| `GET /commission` | the platform's cut, per order, at the rate it was billed |
| `GET /reports/margins` | what actually makes money |
| `POST /expenses` | the one write, and the reason `profit` is true |

Nothing on this list needs a new endpoint.

## Why expenses can be written from a phone

The dashboard publishes `profit`, and profit is revenue minus cost minus
expenses. A shop that runs entirely from this app with no way to record a
delivery bag, a gas cylinder or a rider's fuel is shown a profit that is
simply too high — every day, with nothing on screen to say so.

It is the smallest possible form: amount, category, note, date, a photo of
the bill. Budgets, recurring templates and supplier linkage stay in the
panel.

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
