<?php

namespace App\Providers;

use App\Support\BranchContext;
use App\Support\RegisterContext;
use App\Support\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
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
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureRateLimiting();
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

        RateLimiter::for('otp', function (Request $request) {
            return [
                Limit::perMinute(1)->by('otp-min:'.$request->ip()),
                Limit::perHour(5)->by('otp-hour:'.$request->ip()),
            ];
        });
    }
}
