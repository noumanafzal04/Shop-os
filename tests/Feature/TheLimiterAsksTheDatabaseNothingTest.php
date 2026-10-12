<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Cache\RateLimiter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * THE RATE LIMITER ASKS THE DATABASE NOTHING.
 *
 * ── What was measured ────────────────────────────────────────────────
 *
 * A list of suppliers ran thirteen queries, and two of them were about
 * suppliers. Six were the rate limiter counting the request in the `cache`
 * table — four reads, a row lock and a write — because the app's cache is the
 * database and the limiter counts wherever the cache is. On EVERY request.
 *
 * So where the cache is the database the limiter counts in files
 * (`config/cache.php`, `limiter`). This holds three things in place: the rule
 * in the config, that a counted request really does leave the `cache` table
 * alone, and that the limiter still refuses the request after the last one
 * allowed — a limiter moved somewhere it cannot count is no limiter.
 */
class TheLimiterAsksTheDatabaseNothingTest extends TestCase
{
    use RefreshDatabase;

    private string $counted;

    protected function setUp(): void
    {
        parent::setUp();

        // The app as it runs on a server: the cache in the database, the
        // limiter in files — its own folder, so a run of the tests never
        // touches the counts of an app somebody is using.
        $this->counted = storage_path('framework/testing/limiter-'.uniqid());
        config([
            'cache.default' => 'database',
            'cache.limiter' => 'file',
            'cache.stores.file.path' => $this->counted,
            'cache.stores.file.lock_path' => $this->counted,
        ]);
        $this->app['cache']->forgetDriver('file');

        // The limiter was built when the app booted, on the tests' own cache.
        // It is handed the file store here rather than thrown away and built
        // again: the limits themselves ("api", "pos", "auth") are registered
        // ON it, and a new one would know none of them.
        $files = $this->app['cache']->store('file');
        (function () use ($files): void {
            $this->cache = $files;
        })->call($this->app->make(RateLimiter::class));
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->counted);

        parent::tearDown();
    }

    /** What `config/cache.php` answers for `limiter`, in a given environment. */
    private function limiterWhen(array $env): ?string
    {
        $before = [];
        foreach (['CACHE_STORE', 'CACHE_LIMITER'] as $key) {
            $before[$key] = [$_ENV[$key] ?? null, $_SERVER[$key] ?? null, getenv($key)];
            unset($_ENV[$key], $_SERVER[$key]);
            putenv($key);
        }
        foreach ($env as $key => $value) {
            $_ENV[$key] = $_SERVER[$key] = $value;
            putenv("{$key}={$value}");
        }

        try {
            return (require config_path('cache.php'))['limiter'];
        } finally {
            foreach ($before as $key => [$env_, $server, $os]) {
                unset($_ENV[$key], $_SERVER[$key]);
                putenv($key);
                if ($env_ !== null) {
                    $_ENV[$key] = $env_;
                }
                if ($server !== null) {
                    $_SERVER[$key] = $server;
                }
                if ($os !== false) {
                    putenv("{$key}={$os}");
                }
            }
        }
    }

    public function test_where_the_cache_is_the_database_the_limiter_counts_in_files(): void
    {
        $this->assertSame('file', $this->limiterWhen(['CACHE_STORE' => 'database']));
        // Nothing said at all is the database too — it is the default.
        $this->assertSame('file', $this->limiterWhen([]));
        // A cache that is not the database is already somewhere cheap to count.
        $this->assertNull($this->limiterWhen(['CACHE_STORE' => 'redis']));
        $this->assertNull($this->limiterWhen(['CACHE_STORE' => 'array']));
        // And a store that is NAMED is the store, whatever the cache is.
        $this->assertSame('redis', $this->limiterWhen(['CACHE_STORE' => 'database', 'CACHE_LIMITER' => 'redis']));
    }

    public function test_a_counted_request_leaves_the_cache_table_alone(): void
    {
        $shop = Tenant::factory()->provisioned()->create();
        $owner = User::factory()->shopOwner($shop)->create();
        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $onTheCacheTable = [];
        DB::listen(function ($query) use (&$onTheCacheTable): void {
            if (preg_match('/\b(from|into|update)\s+["`]?cache["`]?\b/i', $query->sql)) {
                $onTheCacheTable[] = $query->sql;
            }
        });

        $answer = $this->withToken($token)->getJson('/api/v1/suppliers')->assertOk();

        // It WAS counted — the limiter said how many are left…
        $this->assertSame('240', $answer->headers->get('X-RateLimit-Limit'));
        $this->assertSame('239', $answer->headers->get('X-RateLimit-Remaining'));
        // …and not one query of the request was the count.
        $this->assertSame([], $onTheCacheTable, 'the rate limiter is counting in the database again');
    }

    public function test_counted_in_files_the_limiter_still_refuses_the_request_after_the_last_one_allowed(): void
    {
        // Signing in is five a minute for one address.
        $try = fn () => $this->postJson('/api/v1/auth/login', ['email' => 'nobody@qa.test', 'password' => 'wrong-password']);

        for ($attempt = 1; $attempt <= 5; $attempt++) {
            $this->assertNotSame(429, $try()->getStatusCode(), "attempt {$attempt} of the five allowed was refused");
        }

        $try()->assertStatus(429);
    }
}
