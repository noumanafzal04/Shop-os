<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Models\User;
use App\Support\FrontDoor;
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
        // Asked twice in one process, the second answer carried the first's
        // findings: a box that had just been put right was still refused.
        $this->findings = [];

        $this->components->info(config('app.name').' readiness — '.app()->environment());

        $this->checkDebug();
        $this->checkName();
        $this->checkPublishedPasswords();
        $this->checkDemoData();
        $this->checkHttps();
        $this->checkAppKey();
        $this->checkCors();
        $this->checkFrontDoor();
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
     * Accounts a seeder makes with a password that is written in this
     * repository — which is public, so "nobody knows it" was never true.
     *
     * The second was added with the product's own address and was never on
     * this list: a live box could carry it on a super admin and be told it
     * was ready.
     */
    private const PUBLISHED = [
        'admin@shopos.test' => 'password',
        'admin@trueserve.app' => 'Admin@123',
    ];

    private function checkPublishedPasswords(): void
    {
        $present = 0;

        foreach (self::PUBLISHED as $email => $password) {
            $account = User::query()->where('email', $email)->first();

            if ($account === null) {
                continue;
            }
            $present++;

            if (Hash::check($password, $account->password)) {
                $this->blocker(
                    "{$email} still has its published password",
                    "{$email} / {$password} — written in a public repository. Change it before this box takes real money.",
                );

                continue;
            }

            // A `.test` address is a laptop's account. On a live box it is a
            // second super admin that nobody signs in as.
            str_ends_with($email, '.test')
                ? $this->caution('Seeded super admin exists', "{$email} — its password has been changed. Consider removing the account entirely.")
                : $this->pass('Seeded admin', "{$email} — password changed");
        }

        if ($present === 0) {
            $this->pass('Seeded super admins', 'not present');
        }
    }

    /**
     * The name a customer reads — on every sign-in code, every e-mail, every
     * receipt — is whatever THIS box's `.env` says, and a box set up before a
     * rename goes on saying the old one. The live API was answering as the
     * product's previous name a month after the panel had stopped.
     *
     * The repository's own `.env.example` carries the name as it is today, so
     * that is what a box is compared with: no name is typed here.
     */
    private function checkName(): void
    {
        $name = (string) config('app.name');
        $shipped = $this->shippedName();

        if ($shipped !== null && $shipped !== $name) {
            $this->caution(
                "This install calls the product \"{$name}\"",
                "The repository calls it \"{$shipped}\". Set APP_NAME in .env — it is the name on every sign-in code, e-mail and receipt.",
            );

            return;
        }

        $this->pass('APP_NAME', $name);
    }

    private function shippedName(): ?string
    {
        $example = base_path('.env.example');

        if (! is_file($example)) {
            return null;
        }

        return preg_match('/^APP_NAME=(["\']?)(.+?)\1\s*$/m', (string) file_get_contents($example), $m) === 1 ? $m[2] : null;
    }

    /**
     * The API's own address in a browser. With nowhere to send a visitor it
     * says "this is the API" — true, and no use to a shopkeeper who typed the
     * name they were given.
     */
    private function checkFrontDoor(): void
    {
        $panel = FrontDoor::panel();

        if ($panel === null && app()->environment('production')) {
            $this->caution(
                'This install does not know where its panel is',
                'Somebody who types this address sees a bare API answer. Set PANEL_URL (or CORS_ALLOWED_ORIGINS) to the panel\'s address.',
            );

            return;
        }

        $this->pass('Panel', $panel ?? 'not set (non-production)');
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
     * `*` invites any page on the internet to script requests against this API
     * from a signed-in merchant's browser. It is the right setting on a laptop,
     * where the panel, the mobile bundler and a phone on the LAN all call from
     * different origins, and the wrong one the moment the box is public.
     */
    private function checkCors(): void
    {
        $origins = (array) config('cors.allowed_origins', []);

        if (in_array('*', $origins, true)) {
            if (app()->environment('production')) {
                $this->blocker(
                    'CORS accepts every origin',
                    'Set CORS_ALLOWED_ORIGINS to the panel\'s own origin(s), comma-separated.',
                );

                return;
            }

            $this->caution('CORS accepts every origin', 'Fine locally. Set CORS_ALLOWED_ORIGINS before this box is public.');

            return;
        }

        $this->pass('CORS', implode(', ', $origins));
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
