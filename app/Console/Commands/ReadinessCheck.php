<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

/**
 * Is this install fit for a real shop's money?
 *
 * The launch checklist has lived in prose across HANDOVER.md and the deployment
 * doc since July, and prose is not checked — the seeded super-admin password and
 * the leaked maps key have both been "still TODO" in writing for two weeks. A
 * check nobody runs is a check that does not exist, so this is the checklist as
 * a command, exiting non-zero when the install is not safe to trade on.
 *
 * Deliberately runnable ON the server against the real database, because that
 * is the only place most of these questions have a true answer. Reads only.
 *
 *     php artisan shopos:readiness
 *
 * Failures block a launch. Warnings are things a shop can open without and
 * should not run for long without.
 */
class ReadinessCheck extends Command
{
    protected $signature = 'shopos:readiness {--strict : Treat warnings as failures}';

    protected $description = 'Check whether this install is safe for a real shop to trade on';

    /** @var list<array{level: string, title: string, detail: string}> */
    private array $findings = [];

    public function handle(): int
    {
        $this->components->info('ShopOS readiness — '.app()->environment());

        $this->checkDebug();
        $this->checkSeededSuperAdmin();
        $this->checkDemoData();
        $this->checkHttps();
        $this->checkAppKey();
        $this->checkQueueAndSchedule();

        return $this->report();
    }

    /**
     * APP_DEBUG on a live box prints stack traces — file paths, SQL, and
     * whatever was in scope — to anyone who can trigger a 500.
     */
    private function checkDebug(): void
    {
        if (config('app.debug') && app()->environment('production')) {
            $this->blocker('APP_DEBUG is on in production', 'A 500 shows stack traces, SQL and config to whoever triggered it.');

            return;
        }

        $this->pass('APP_DEBUG', config('app.debug') ? 'on (non-production)' : 'off');
    }

    /**
     * The seeded owner account. Its password is published in this repo's README
     * and the repo is public, so "nobody knows it" was never true.
     */
    private function checkSeededSuperAdmin(): void
    {
        $admin = User::query()->where('email', 'admin@shopos.test')->first();

        if ($admin === null) {
            $this->pass('Seeded super admin', 'not present');

            return;
        }

        if (Hash::check('password', $admin->password)) {
            $this->blocker(
                'The seeded super admin still has its published password',
                'admin@shopos.test / password — documented in a public repo. Change it before this box takes real money.',
            );

            return;
        }

        $this->caution('Seeded super admin exists', 'Password has been changed. Consider removing the account entirely.');
    }

    /** Demo tenants on a live box are somebody's shop name next to fake sales. */
    private function checkDemoData(): void
    {
        if (! Schema::hasTable('tenants')) {
            return;
        }

        $demo = Tenant::query()->whereIn('email', ['tenant1@app.com', 'tenant2@app.com'])->count();

        if ($demo > 0 && app()->environment('production')) {
            $this->blocker('Demo tenants are present in production', "{$demo} found. DatabaseSeeder gates these on the environment — something forced them.");

            return;
        }

        $this->pass('Demo data', $demo > 0 ? "{$demo} demo tenants (non-production)" : 'none');
    }

    /**
     * Plain HTTP costs more than eavesdropping here: browsers withhold the
     * secure-context APIs from it. `crypto.randomUUID` being undefined over
     * HTTP already crashed the POS once, and the offline PWA cannot register a
     * service worker at all without this.
     */
    private function checkHttps(): void
    {
        $url = (string) config('app.url');

        if (! str_starts_with($url, 'https://')) {
            $this->caution(
                'APP_URL is not HTTPS',
                "{$url} — browsers withhold secure-context APIs over plain HTTP. This already broke the POS once (crypto.randomUUID), and the offline PWA cannot register a service worker without it.",
            );

            return;
        }

        $this->pass('APP_URL', $url);
    }

    private function checkAppKey(): void
    {
        if (config('app.key') === null || config('app.key') === '') {
            $this->blocker('APP_KEY is empty', 'Sessions and every encrypted column are unreadable or forgeable.');

            return;
        }

        $this->pass('APP_KEY', 'set');
    }

    /**
     * A queue worker that is not running looks like nothing at all: jobs pile
     * up silently and the shop notices when a receipt never sends.
     */
    private function checkQueueAndSchedule(): void
    {
        if (config('queue.default') === 'sync' && app()->environment('production')) {
            $this->caution(
                'Queue is running synchronously',
                'Every queued job runs inside the web request that made it, so a slow job is a slow checkout.',
            );

            return;
        }

        $this->pass('Queue', (string) config('queue.default'));
    }

    // ── Reporting ───────────────────────────────────────────────────

    private function pass(string $title, string $detail): void
    {
        $this->components->twoColumnDetail("<fg=green>PASS</> {$title}", $detail);
    }

    private function blocker(string $title, string $detail): void
    {
        $this->findings[] = ['level' => 'fail', 'title' => $title, 'detail' => $detail];
        $this->components->twoColumnDetail("<fg=red>FAIL</> {$title}", '');
    }

    private function caution(string $title, string $detail): void
    {
        $this->findings[] = ['level' => 'warn', 'title' => $title, 'detail' => $detail];
        $this->components->twoColumnDetail("<fg=yellow>WARN</> {$title}", '');
    }

    private function report(): int
    {
        $fails = array_filter($this->findings, fn (array $f): bool => $f['level'] === 'fail');
        $warns = array_filter($this->findings, fn (array $f): bool => $f['level'] === 'warn');

        $this->newLine();

        foreach ($this->findings as $f) {
            $tag = $f['level'] === 'fail' ? '<fg=red>FAIL</>' : '<fg=yellow>WARN</>';
            $this->line("  {$tag} {$f['title']}");
            $this->line("       {$f['detail']}");
            $this->newLine();
        }

        if ($fails !== []) {
            $this->components->error(count($fails).' blocking issue(s). This install is not ready to take money.');

            return self::FAILURE;
        }

        if ($warns !== [] && $this->option('strict')) {
            $this->components->error(count($warns).' warning(s), and --strict was given.');

            return self::FAILURE;
        }

        $this->components->info($warns === [] ? 'Ready.' : 'Ready, with '.count($warns).' warning(s).');

        return self::SUCCESS;
    }
}
