# Country → province → city (2026-10-25)

**The user, 2026-10-25:** a country / province / city select, from our own database — "achy waly
jis main lat long b ho" — Pakistan only for now, with the dataset's own ids so another country
is easy later; nothing that is already built and tested may break.

## What was there

One `cities` table with eight rows (CitySeeder), no country, no province, no admin screen. A
shop in Sialkot could not say where it was. Four tables point at a city by UUID: `tenants`,
`branches`, `customer_addresses`, `rider_profiles` (all nullable, null on delete).

## What was built

- **Data:** the open *countries-states-cities-database* (github.com/dr5hn, **ODbL 1.0** — the
  data source must be credited where it is shown). `scripts/geo-extract.py <all.json> PK` cuts one
  country into `backend/database/data/geo/PK.json`: 7 provinces, 458 cities, every one with
  coordinates. Accent marks and curly apostrophes are written plainly ("Muzaffarabad",
  "Khairpur Mir's"). The full dataset is on the user's Desktop, `geo-data/`.
- **Tables** (migration `2026_10_25_000001`, additive): `countries` and `provinces` keyed by the
  dataset's ids (Pakistan 167, Punjab 3176); `cities` gains `geo_id` (the dataset's city id,
  Lahore 85572), `province_id`, `country_id`, all nullable. A city keeps its UUID — four tables
  point at it. The name is unique per province, not nationally: there are two real Nasirabads
  (Sindh, Balochistan).
- **Import:** `php artisan shopos:geo PK` (no argument = every file in `database/data/geo`), also
  `GeoSeeder` in the production bootstrap. A city is found by `geo_id`; a city from before the
  dataset by its name, and JOINED — its UUID kept, so no shop loses its city and none doubles.
  A coordinate a person entered and a city switched off are left as they are. Re-runnable.
- **API:** `GET /countries`, `GET /provinces?country_id=`, `GET /cities?country_id=&province_id=`
  (with no filter, every active city, as before — now with `province_id`, coordinates).
  `Cache-Control: public, max-age=86400`; the panel keeps them for the session (`staleTime:
  Infinity`).
- **Marketplace GPS** (`/marketplace/locate`): the nearest city WITH SHOPS first; only a
  platform with no shop anywhere names the nearest town. With 458 cities the nearest centre is
  often a town beside the city with nothing in it. Server-side, so the mobile app needs no change.
- **Demo:** demo shops in the launch cities (`City::MAJOR`), not in whichever towns sort first.
- **Panel:** `common/geo/places.ts` (hooks + `cityForPin`), `common/geo/CityPicker.tsx` — Province
  narrows the City list; choosing a city fills its province; Country always shown, Pakistan by
  default (panel `0e03784`); the city is still a select labelled "City". On Admin new shop, Admin shop detail, Shop
  setup, Shop settings. The marketplace header's switch lists only cities with shops.
- **A map pin's city** (`cityForPin`): the exact name, written plainly; else the nearest city
  within 40 km; else nothing. The old "a city whose name is inside the map's answer" matched
  "Uch" inside "Kuchlak".

## Deploy

Backend first: `php artisan migrate`, then `php artisan shopos:geo PK`. Then the panel. No fresh
migrate needed — existing shops keep their city.

## Later

Another country: `python3 -I scripts/geo-extract.py ~/Desktop/geo-data/all.json AE`, then
`php artisan shopos:geo AE`. It appears in the Country select by itself; nothing else changes.
No admin screen for places yet; the mobile app's own city screens were not touched.
