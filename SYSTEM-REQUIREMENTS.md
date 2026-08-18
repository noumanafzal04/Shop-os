# System requirements

Everything needed to run ShopOS on a fresh machine. Versions below are what the
code is **actually built and tested against** — read from `composer.json`,
`package.json` and the running toolchain on 2026-08-18, not from memory.

Three applications live side by side under one folder:

```
shopos/
├── shopos-backend/                 Laravel API
├── shopos-admin-and-user-panel/    React panel + POS (PWA)
├── shopos-mobile/                  React Native customer app
└── docs/                           decisions, memory, plans
```

They must stay **siblings**: `shopos-backend/scripts/dead-endpoints.py` reads the
other two to check that every API route has a caller and every client call has a
route.

---

## 1. Core toolchain

| Tool | Required | Known good | Notes |
|---|---|---|---|
| **PHP** | `^8.3` | **8.4.7** | CI and the droplet both run **8.4** — match it |
| **Composer** | 2.x | 2.8.9 | |
| **Node** | ≥ 22.11 (mobile engines) | **23.11.0** | CI deploys the panel on Node **20**; 20–23 all build |
| **npm** | 10.x | 10.9.2 | |
| **MySQL** | 8.x or 9.x | server **9.6.0**, client 8.4.7 | |
| **Git** | any | | |
| **Python** | 3.x | | only for `scripts/dead-endpoints.py` |

### PHP extensions

```
bcmath  ctype  curl  dom  fileinfo  gd  intl  mbstring  openssl
pcre    pdo    pdo_mysql  pdo_sqlite  sqlite3  tokenizer  xml  zip
```

`pdo_sqlite` + `sqlite3` are **not optional**: the test suite pins SQLite
`:memory:` in `phpunit.xml`, so `php artisan test` needs them even though the app
runs on MySQL.

---

## 2. Backend — `shopos-backend/`

| Package | Version |
|---|---|
| `laravel/framework` | `^13.8` (running **13.19.0**) |
| `laravel/sanctum` | `^4.0` |
| `laravel/tinker` | `^3.0` |
| `doctrine/dbal` | `^4.4` |
| `phpunit/phpunit` | `^12.5.12` |
| `laravel/pint` | `^1.27` |

```bash
cd shopos-backend
composer install
cp .env.example .env
php artisan key:generate
# create the database first, then:
php artisan migrate --seed
php artisan storage:link          # product images 404 without this
php artisan serve --port=8000
```

### Services

- **Queue** — `QUEUE_CONNECTION=database`. No Redis needed to run. In production
  a worker is supervised (`supervisorctl restart shopos-worker`); locally run
  `php artisan queue:work` when testing anything queued.
- **Cache / session** — `database`. Redis settings exist in `.env.example` but
  nothing requires Redis.
- **Mail** — `log` by default; mail lands in `storage/logs`.

### Before a box is public

```bash
php artisan shopos:readiness      # exits non-zero when this install is not safe to trade on
```

It checks `APP_DEBUG`, the seeded super-admin password, demo tenants, HTTPS,
`APP_KEY`, `CORS_ALLOWED_ORIGINS` and the queue driver. **Nothing runs it
automatically** — not CI, not the deploy.

---

## 3. Panel / POS — `shopos-admin-and-user-panel/`

| Package | Version |
|---|---|
| **React** | `^19.0.0` |
| **react-dom** | `^19.0.0` |
| **react-router** | `^7.18.2` |
| **TypeScript** | `~5.7.2` |
| **Vite** | `^6.1.0` |
| **Tailwind CSS** | `^4.0.8` (via `@tailwindcss/postcss`) |
| **TanStack Query** | `^5.101.2` |
| **zustand** | `^5.0.14` |
| **axios** | `^1.18.1` |
| **vite-plugin-pwa** | `^1.3.0` |
| **Vitest** | `^3.2.7` · jsdom `^27` · `fake-indexeddb` `^6.2.5` |
| **ESLint** | `^9.19.0` + `typescript-eslint` `^8.22.0` |
| charts / maps | `apexcharts` `^4.1.0`, `leaflet` `^1.9.4` |

```bash
cd shopos-admin-and-user-panel
npm install
npm run dev                       # http://localhost:5173
```

### Testing offline needs the BUILT app

```bash
npm run build && npm run preview  # http://localhost:4173
```

`devOptions.enabled: false` in `vite.config.ts` — **the service worker does not
exist on the dev server**, so port 5173 can never test offline. Go offline with
**DevTools → Network → Offline**, not by turning wifi off: the API is on
`localhost`, which wifi does not interrupt.

---

## 4. Mobile — `shopos-mobile/`

| Package | Version |
|---|---|
| **React Native** | `0.86.0` |
| **React** | `19.2.3` |
| **TypeScript** | `^5.8.3` |
| **Jest** | `^29.6.3` |
| Node engine | `>= 22.11.0` |

Needs Xcode (iOS) or Android Studio + JDK 17 (Android). CocoaPods for iOS.

```bash
cd shopos-mobile
npm install
npm start
```

---

## 5. Gates — what must pass

Run from each app's own directory.

```bash
# backend
php artisan test
./vendor/bin/pint app/Path/To/Changed.php     # specific paths, NEVER repo-wide

# panel
npx tsc --noEmit -p tsconfig.app.json
npx eslint src                                # baseline: 0 errors, 18 warnings
npx vitest run
npm run build

# mobile
npx tsc --noEmit
npx jest

# cross-repo (needs all three checked out as siblings)
python3 shopos-backend/scripts/dead-endpoints.py
```

Current green counts: **backend 2069**, **panel 974**, **mobile 31**.

---

## 6. Two things that bite on a fresh machine

**Decimal columns come back as strings.** Use `assertEquals`, not `assertSame`,
in backend tests. And Eloquent's `create()` does not hydrate columns the insert
did not name — `->refresh()` before reading them back.

**`migrate:fresh` and `DemoDataSeeder` are staging-only.** They must never run
against production data.
