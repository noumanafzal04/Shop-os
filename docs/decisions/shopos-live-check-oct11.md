# The live box, looked at from outside (2026-10-11)

The "live check" half of *"Dono: local full + live check"*. Nothing was changed
on the server and nobody was signed in as: public pages were read, and the
public **Try demo** was pressed once (a Mart; it clears itself in a day).
The live box is still on the build pushed before the warehouse, wholesale,
menu and billing work — so this is a check of what is deployed, not of today.

## What works

| Looked at | Result |
|---|---|
| `panel.cartze.shop/` landing, 1366×768 and a phone | loads, no console error, no refused request, no sideways scroll |
| `/signin` | loads, same |
| Try demo → Mart | a shop in 2.1 s; the till opens stocked, says **Online**, nothing refused |
| `cartze.shop/api/v1/health` | 200; an unknown path answers the API's own "Resource not found", not a stack trace |
| `http://` | 301 to `https://` on both hosts |
| `.env`, `.git/config`, `storage/logs`, `/telescope` | not served |

## What is wrong, measured

| # | What | Measured | Whose |
|---|---|---|---|
| 1 | **JavaScript, CSS and JSON go out uncompressed** | first visit: `index-*.js` 605 KB + `index-*.css` 219 KB = **824 KB on the wire; 225 KB gzipped (−73%)**. The sign-in page took 7.9 s to load on a phone's hotspot. Only `index.html` is compressed — Ubuntu's nginx ships `gzip on` with `gzip_types` commented out | server |
| 2 | **No `Cache-Control` on anything** | every hashed asset is asked for again (ETag → 304) on every visit; nothing tells a browser `index.html` and `sw.js` must NOT be kept | server |
| 3 | `manifest.webmanifest` is served as `application/octet-stream` | should be `application/manifest+json` | server |
| 4 | **`https://cartze.shop/` is Laravel's welcome page** — "Deploy now", Laracasts — titled with the product's old name | the address the product is known by | **code — fixed, see below** |
| 5 | The API calls itself **"ShopOS"** | `APP_NAME` in the live `.env`; it is the name on every sign-in code and e-mail | server `.env` — readiness now says so |
| 6 | `Access-Control-Allow-Origin: *` | `CORS_ALLOWED_ORIGINS` is not set; `shopos:readiness` already refuses this in production | server `.env` |
| 7 | No `Strict-Transport-Security`, no `X-Content-Type-Options` | — | server |

### The lines for nginx (1, 2, 3, 7)

In `/etc/nginx/nginx.conf`, inside `http { }` — `gzip on;` is already there:

```nginx
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types text/plain text/css application/javascript application/json
           application/manifest+json image/svg+xml application/xml;
```

In the panel's `server { }`:

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
add_header X-Content-Type-Options "nosniff" always;

# Hashed by the build: the name changes when the file does.
location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;          # NOT /index.html — a missing chunk must not be cached as a page
}

# Never kept: these are how the app finds out there is a newer version.
location = /sw.js                { add_header Cache-Control "no-cache"; }
location = /manifest.webmanifest { default_type application/manifest+json; add_header Cache-Control "no-cache"; }
location / {
    add_header Cache-Control "no-cache";
    try_files $uri $uri/ /index.html;
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`. To see it worked:

```sh
curl -sI -H 'Accept-Encoding: gzip' https://panel.cartze.shop/assets/<any>.js | grep -iE 'content-encoding|cache-control'
```

`.env` on the API (5, 6), then `php artisan config:cache`:

```
APP_NAME="True Serve"
CORS_ALLOWED_ORIGINS=https://panel.cartze.shop
PANEL_URL=https://panel.cartze.shop
```

## What changed in the code because of it

- **The API's own address** (`routes/web.php`) no longer shows the framework's
  page. A visitor is sent to the panel when the install knows where it is —
  `PANEL_URL`, or the first origin in `CORS_ALLOWED_ORIGINS`, which is the
  panel's own (`App\Support\FrontDoor`) — and is told "this is the API" when it
  does not. A panel at the same host is never a redirect to itself. The
  welcome view and the framework's `ExampleTest` (which asserted a 200 and was
  satisfied by that page) are deleted. `TheApisOwnAddressTest`.
- **`shopos:readiness`** now also checks: the second seeded admin
  (`admin@trueserve.app` / `Admin@123` was never on its list — a live box could
  carry it and be told it was ready); the product's name against the
  repository's own `.env.example` (no name is typed in the command); and
  whether the install knows where its panel is.
- **`SuperAdminSeeder`** no longer writes `password` back onto
  `admin@shopos.test` on a live box. It did so on every `db:seed`, which undid
  the one thing the launch checklist asks for. A laptop keeps the old
  behaviour. `ASeedDoesNotPutAPasswordBackTest`.

## Before a real shop pays

`php artisan shopos:readiness` on the server, and it must exit 0. Today it
would stop on: the two published passwords (after a fresh seed), CORS `*`,
and warn on the name.
