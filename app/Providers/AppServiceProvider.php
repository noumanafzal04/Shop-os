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
        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
        });

        // Tight limits on credential/OTP endpoints (brute-force protection).
        RateLimiter::for('auth', function (Request $request) {
            return Limit::perMinute(5)->by($request->ip());
        });

        RateLimiter::for('otp', function (Request $request) {
            return [
                Limit::perMinute(1)->by('otp-min:'.$request->ip()),
                Limit::perHour(5)->by('otp-hour:'.$request->ip()),
            ];
        });
    }
}
