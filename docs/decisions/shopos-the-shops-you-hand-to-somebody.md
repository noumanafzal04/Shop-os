# The shops you hand to somebody: `demo:shops`, and a second administrator

**2026-10-09 · asked for by the owner**

> "Aik tenant create krna hai shop1@johartown.demo / password jis main 500+
> products, sales or uski categories — mean real time data — kisi ko demo k
> liye share krna hai. Restaurant cafe ka banana hai ye; is tarah shop2 mart or
> baki… din-in tables, kitchen tickets ye sb add hona chahye."
>
> "Super admin aik or bnana hai: admin@trueserve.app / Admin@123."

## What there was

Two things, and neither was this:

- The **demo world** (`DemoDataSeeder`): fifty products and a handful of sales
  per shop. It proves the screens render.
- The **load test** (`loadtest:shops`): shops at the size real shops are, built
  through the product's own actions — every sale rung, every tab opened, fired
  and settled, every delivery booked in. It is the only thing in the repository
  that builds a shop with a real trading history, and its goods are called
  "Chicken Karahi Half #1" because it exists to be big.

## Now

`php artisan demo:shops` borrows the whole of the load test's builder and
changes two things: **what the goods are called, and who the people are.**

| Sign in as | Shop | Trade | What is in it |
|---|---|---|---|
| shop1@johartown.demo | Johar Café & Grill | food | 628 dishes in 28 sections, 8 kitchen stations, 60 tables, tabs, dockets |
| shop2@johartown.demo | Johar Fresh Mart | mart | 537 lines by brand and pack size, weighed aisles |
| shop3@johartown.demo | CarePlus Pharmacy | pharmacy | 250 medicines with salts, batches and expiry dates |
| shop4@johartown.demo | Zari Clothing | retail | 82 designs in sizes and colours |
| shop5@johartown.demo | FixIt Service Centre | services | 83 repair jobs, job cards and quotes |
| shop6@johartown.demo | Johar Auto Care | automotive | 254 parts by car, vehicles, jobs |
| shop7@johartown.demo | Canal Road Fuels | petroleum | tanks, pumps, shifts, a tuck shop |
| shop8@johartown.demo | GadgetHub | online | 110 gadgets, orders only — it has no till |
| shop9@johartown.demo | Malik & Co. Accounts | finance | books only |

Every password is `password`. Each shop opens in its own brand colour.

    php artisan demo:shops                 # build what is not there yet
    php artisan demo:shops --fresh         # remove these nine and build them again
    php artisan demo:shops --only=shop1    # one shop, by login or by trade
    php artisan demo:shops --listed        # leave them open on the public marketplace

It is also the last step of `db:seed`, so `migrate:fresh --seed` on a new server
ends with the nine logins in place (`DemoShopsSeeder`; not under test).

### Why it is safe on a live server

- **It needs no development package.** The load test makes its rows with
  factories; a factory needs Faker; `composer install --no-dev` does not
  install it. The owner deploys with `--no-dev`, so the first run on the server
  would have died on its first line. The four places a row was made by a
  factory are two overridable methods now, and this command makes its rows by
  hand. Proved by building all nine with Faker made to throw.
- **It writes only its own shops** (slug `jtdemo-…`) and `--fresh` removes only
  those — not `demo-mart`, not a "Try the demo" shop, not the Johar Town
  seeder's.
- **A shop that is already there is left as it is.** A second run is not a
  reset of a shop somebody has been shown round.
- **It does not touch a platform setting.** The load test switches commission
  on; that is not this command's to decide on a live platform.
- **The shops are not on the public marketplace** unless `--listed` is passed.
  Their order history is real and the owner sees it; a stranger cannot find one
  and order dinner from a restaurant that does not exist.

### Things the builder was made to do differently (for both commands)

- A shop with no till rings nothing up (`sales()` asked nobody). The load
  test's nine trades all have one; an online-only shop does not.
- How many of one thing goes in a basket is a method, because three phones and
  two smart watches in one sale is half a million rupees — and the first
  number a visitor looks at.
- Two `UPDATE products p SET …` statements lost their alias. MySQL allows one
  there and SQLite does not; the builder had never been run under the test
  database at all.

## The second administrator

`SuperAdminSeeder` makes `admin@trueserve.app` / `Admin@123` — with
`firstOrCreate`, where `admin@shopos.test` is `updateOrCreate`. The seeder runs
on every `db:seed`, and one that writes the password each time puts a known
password back on a live administrator whenever somebody seeds.

**`Admin@123` is in the repository.** It is a first password: change it at the
first sign-in on any server a stranger can reach. Seeding again will not undo
the change.

## Held by

`tests/Feature/DemoShopsCommandTest.php` (10): the menu is 500+ dishes named
once with a station each; every other shop's goods are named once and none
carries the load test's `#n`; the command makes its rows itself; the restaurant
has a floor in use and a kitchen that was sent orders, and is not visible on
the marketplace; **all nine trades build** and each has its login; a shop
already there is left alone; `--fresh` takes nothing that is not its own; an
unknown shop builds nothing; the administrator's changed password is never put
back.

## Not done

- **No product photos and no logos.** The only art the repository can draw is
  a coloured tile with bitmap lettering, which reads worse than the panel's own
  initial tiles. Real pictures need real files.
- The nine-trade test takes about a hundred seconds, which is most of what the
  suite gained in a month.
