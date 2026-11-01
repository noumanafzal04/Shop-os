<?php

namespace Database\Seeders;

use App\Console\Commands\ReadinessCheck;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * THE PLATFORM'S SUPER ADMINS.
 *
 * ── On a live box ───────────────────────────────────────────────────
 *
 * Only the accounts named in .env (`config/platform.php`): SUPER_ADMIN_* and
 * SUPER_ADMIN_2_*. Nothing with a password written in this repository is made
 * there — the repository is public, and the two laptop accounts below used to
 * arrive on a live server with their published passwords.
 *
 * Each is made ONCE. A seed runs again on every `db:seed`, and a seeder that
 * wrote the password each time would put the .env one back over the one the
 * owner chose at their first sign-in.
 *
 * ── On a laptop ─────────────────────────────────────────────────────
 *
 * The two development accounts as well: `admin@shopos.test`, which every e2e
 * run signs in as and which a re-seed puts right, and the product's own
 * address for the demo shops. Neither is made in production.
 */
class SuperAdminSeeder extends Seeder
{
    /** Shorter than this and the account is not made — a live admin guards every shop's takings. */
    public const MIN_PASSWORD = 10;

    public function run(): void
    {
        if (! app()->environment('production')) {
            $this->laptopAccounts();
        }

        $made = 0;
        foreach ((array) config('platform.super_admins', []) as $i => $admin) {
            $email = trim((string) ($admin['email'] ?? ''));
            $password = (string) ($admin['password'] ?? '');
            if ($email === '') {
                continue;
            }

            if (User::query()->where('email', $email)->exists()) {
                $made++;
                $this->say("{$email} is already there — its password was left as it is.");

                continue;
            }

            if (mb_strlen($password) < self::MIN_PASSWORD) {
                $this->say("{$email} was NOT made: give it a password of at least ".self::MIN_PASSWORD.' characters in .env.', true);

                continue;
            }

            User::query()->create([
                'name' => trim((string) ($admin['name'] ?? '')) ?: 'Super Admin',
                'email' => $email,
                'password' => $password, // hashed by the model's cast
                'role' => UserRole::SuperAdmin,
                'status' => UserStatus::Active,
                'tenant_id' => null,
                'email_verified_at' => now(),
            ]);
            $made++;
            $this->say("Super admin {$email} made.");
        }

        if ($made === 0 && app()->environment('production')) {
            $this->say('No super admin on this box. Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env, run config:cache, then db:seed --class=SuperAdminSeeder --force.', true);
        }
    }

    /** Development only — see the class note. */
    private function laptopAccounts(): void
    {
        $base = [
            'role' => UserRole::SuperAdmin,
            'status' => UserStatus::Active,
            'tenant_id' => null,
            'email_verified_at' => now(),
        ];

        // Re-seeding a laptop is how an admin a test has broken is put right.
        // Their passwords are the published ones the readiness check refuses on
        // a live box — one list, so the two can never part.
        $published = ReadinessCheck::PUBLISHED;
        User::query()->updateOrCreate(['email' => 'admin@shopos.test'], [...$base, 'name' => 'Super Admin', 'password' => $published['admin@shopos.test']]);

        // The demo shops' platform account: made once, never re-set.
        User::query()->firstOrCreate(['email' => 'admin@trueserve.app'], [
            ...$base,
            'name' => config('app.name').' Admin',
            'password' => $published['admin@trueserve.app'],
        ]);
    }

    private function say(string $line, bool $warn = false): void
    {
        if ($this->command === null) {
            return;
        }

        $warn ? $this->command->warn($line) : $this->command->info($line);
    }
}
