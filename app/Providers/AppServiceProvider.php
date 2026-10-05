<?php

namespace App\Providers;

use App\Support\BranchContext;
use App\Support\RegisterContext;
use App\Support\TaxGroupRates;
use App\Support\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // One tenant context per request lifecycle (Octane-safe).
        $this->app->scoped(TenantContext::class);
        // Active operating branch — same per-request lifecycle as the tenant.
        $this->app->scoped(BranchContext::class);
        $this->app->scoped(RegisterContext::class);
        // A tax group's rate, remembered for ONE request so a page of
        // products does not ask once per row. Scoped rather than a
        // singleton: a rate held across requests is a re-rated group charged
        // at its old figure until the worker restarts.
        $this->app->scoped(TaxGroupRates::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureRateLimiting();
        $this->pagesHoldStill();
    }

    /**
     * A PAGED LIST HAS ONE ORDER, AND IT IS THE SAME ON EVERY PAGE.
     *
     * Almost every list here is sorted by a date — `created_at`, `sold_at`,
     * `placed_at` — and a date is not unique. When two rows share one, the
     * database may hand them back in either order, and it may choose
     * DIFFERENTLY for page two than it did for page one. A row on the boundary
     * is then shown twice, or not at all.
     *
     * It needs many rows with the same timestamp to show, which is exactly
     * what a bulk action makes: 2,000 products imported from one CSV arrive in
     * the same second. Paged through, 1,989 of them could be reached. Eleven
     * were on no page. A day of offline sales synced at once, or a seeded
     * catalogue, does the same to every other list.
     *
     * `->stably()` goes immediately before `->stably()->paginate()` and adds the row's
     * own key as the LAST word on order, so ties are broken the same way every
     * time. It changes nothing a person asked for: the date still sorts first.
     *
     * Skipped for a grouped or DISTINCT query, where there is no single row's
     * key to order by, and when the key is already in the order.
     * `PagesHoldStillTest` fails if a list is paged without it.
     */
    private function pagesHoldStill(): void
    {
        EloquentBuilder::macro('stably', function () {
            /** @var EloquentBuilder $this */
            $base = $this->getQuery();
            if (! empty($base->groups) || $base->distinct) {
                return $this;
            }

            $model = $this->getModel();
            $key = $model->getQualifiedKeyName();
            foreach ($base->orders ?? [] as $order) {
                if (in_array($order['column'] ?? null, [$key, $model->getKeyName()], true)) {
                    return $this;
                }
            }

            return $this->orderBy($key);
        });

        /*
         * The same promise for a query with no model behind it — the ledger is
         * five tables in a union. There is no key to look up, so the caller
         * names the column that is unique, and has to.
         */
        QueryBuilder::macro('stably', function (string $column) {
            /** @var QueryBuilder $this */
            foreach ($this->orders ?? [] as $order) {
                if (($order['column'] ?? null) === $column) {
                    return $this;
                }
            }

            return $this->orderBy($column);
        });
    }

    private function configureRateLimiting(): void
    {
        // The general ceiling. Blunt on purpose: it exists to stop an
        // authenticated account being used to scrape or hammer, not to pace
        // normal use. 60/min was set when the panel was a handful of pages and
        // is far too tight for a client that invalidates several queries after
        // every write — a single busy screen can spend it in twenty seconds.
        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute(240)->by($request->user()?->id ?: $request->ip());
        });

        // ── The counter ─────────────────────────────────────────────────
        //
        // A till is not a screen somebody browses. Each completed sale is a
        // POST plus the reads that follow it — the product grid, the shift —
        // and a rush-hour cashier rings one every few seconds while scanning
        // and searching in between. The general limit turns that into
        // "Sale failed. Too many requests." with a customer standing at the
        // counter and the goods already bagged.
        //
        // That is the worst failure this system can produce. It is not a
        // degraded read or a slow screen; it is a shop that cannot take money,
        // caused by a number nobody chose with a counter in mind.
        //
        // ── Why it is keyed by DEVICE and not only by user ──────────────
        //
        // Small shops share one login across every till. Keyed by user alone,
        // four lanes would divide one allowance between them and the busiest
        // shop would be the first to be refused — the exact inversion of what
        // a limit is for. The device id is on every till request already.
        //
        // It is still a real ceiling. 600/min is ten requests a second from
        // one till, which no counter reaches and no scraper is satisfied by.
        RateLimiter::for('pos', function (Request $request) {
            $who = $request->user()?->id ?: $request->ip();
            $device = $request->header('X-Device-Id') ?: $request->input('device_id');

            return Limit::perMinute(600)->by('pos:'.$who.':'.($device ?: 'no-device'));
        });

        // Tight limits on credential/OTP endpoints (brute-force protection).
        RateLimiter::for('auth', function (Request $request) {
            return Limit::perMinute(5)->by($request->ip());
        });

        /**
         * "Try the demo" — the one unauthenticated endpoint that CREATES.
         *
         * Every call writes a tenant, an owner and a shelf, so the limit is
         * about what it costs rather than about brute force. Somebody
         * evaluating this needs one shop, or two if they want to compare a
         * restaurant with a pharmacy. Nobody needs twenty, and a script asking
         * for twenty thousand is the only other caller there is.
         */
        RateLimiter::for('demo', function (Request $request) {
            return [
                // The per-minute one is about ACCIDENTS, not abuse — a second
                // press while the first shop is still building. Two was too
                // tight and refused a real thing people do: opening a
                // restaurant, then a pharmacy, to see how different they are.
                Limit::perMinute(5)->by('demo-min:'.$request->ip()),
                // This is the actual fence. Twenty tenants an hour from one
                // address is far more than anybody evaluating needs, and every
                // one of them clears itself away within the day.
                Limit::perHour(20)->by('demo-hour:'.$request->ip()),
            ];
        });

        /*
         * ASKING FOR A PERSON.
         *
         * Far cheaper than a demo — the worst a flood does is fill a list an
         * admin deletes, not build tenants — so the limit is not about cost.
         * It is about the list staying worth reading: a queue with two hundred
         * junk rows in it is a queue nobody opens, and the real enquiry sits
         * in there unanswered.
         */
        RateLimiter::for('enquiry', function (Request $request) {
            return [
                // One person, one form, corrected once. Three is a typo fixed
                // twice, not a campaign.
                Limit::perMinute(3)->by('enquiry-min:'.$request->ip()),
                Limit::perHour(10)->by('enquiry-hour:'.$request->ip()),
            ];
        });

        RateLimiter::for('otp', function (Request $request) {
            return [
                Limit::perMinute(1)->by('otp-min:'.$request->ip()),
                Limit::perHour(5)->by('otp-hour:'.$request->ip()),
            ];
        });
    }
}
