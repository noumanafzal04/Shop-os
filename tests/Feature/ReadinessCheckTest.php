<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The launch checklist, as something that runs.
 *
 * It lived in prose across HANDOVER.md and the deployment doc since July, and
 * prose is not checked: the seeded super-admin password has been "still TODO"
 * in writing for two weeks and is still `password` today. A checklist nobody
 * runs is a checklist that does not exist.
 *
 * These tests are about the EXIT CODE, because that is the part a deploy can
 * act on. A readiness command that prints a red line and exits 0 is decoration.
 */
class ReadinessCheckTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_published_super_admin_password_blocks_a_launch(): void
    {
        User::query()->create([
            'name' => 'Super Admin',
            'email' => 'admin@shopos.test',
            'password' => 'password',
            'role' => UserRole::SuperAdmin,
            'status' => 'active',
        ]);

        $this->artisan('shopos:readiness')->assertExitCode(1);
    }

    public function test_a_changed_password_does_not_block_a_launch(): void
    {
        User::query()->create([
            'name' => 'Super Admin',
            'email' => 'admin@shopos.test',
            'password' => 'a-real-password-nobody-published',
            'role' => UserRole::SuperAdmin,
            'status' => 'active',
        ]);

        $this->artisan('shopos:readiness')->assertExitCode(0);
    }

    public function test_a_clean_install_passes(): void
    {
        $this->artisan('shopos:readiness')->assertExitCode(0);
    }

    public function test_strict_turns_warnings_into_a_refusal(): void
    {
        // APP_URL is http:// under test, which is a warning — the point of
        // --strict is a deploy pipeline that will not ship past one.
        config(['app.url' => 'http://localhost']);

        $this->artisan('shopos:readiness --strict')->assertExitCode(1);
        $this->artisan('shopos:readiness')->assertExitCode(0);
    }
}
