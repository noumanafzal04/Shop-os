<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\SuperAdminSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A SEED DOES NOT PUT A PASSWORD BACK — on a live box.
 *
 * `SuperAdminSeeder` runs on every `db:seed`, and it wrote `password` onto
 * `admin@shopos.test` each time. So the one thing the launch checklist asks
 * for — change that password — was undone by the next person to seed
 * anything, and nothing said so.
 *
 * A laptop keeps the old behaviour on purpose: there, a re-seed is how an
 * admin that a test or a person has broken is put right. A live box gets only
 * the admins named in .env (config/platform.php), each made once.
 */
class ASeedDoesNotPutAPasswordBackTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $email): User
    {
        return User::query()->where('email', $email)->firstOrFail();
    }

    /**
     * The launch (2026-11-01): a live box gets the super admins named in .env
     * and nobody else — none of the accounts whose passwords are written in
     * this public repository.
     */
    private function onALiveBoxWith(array $admins): void
    {
        $this->app['env'] = 'production';
        config(['platform.super_admins' => $admins]);
    }

    public function test_on_a_live_box_only_the_admins_named_in_env_are_made(): void
    {
        $this->onALiveBoxWith([
            ['name' => 'Owner One', 'email' => 'one@platform.test', 'password' => 'a-long-first-password'],
            ['name' => 'Platform Admin', 'email' => 'two@platform.test', 'password' => 'another-long-password'],
        ]);

        // Run as the class, not through `db:seed`: on a live box that command
        // stops to ask "are you sure?", and nobody is here to answer.
        (new SuperAdminSeeder)->run();

        $this->assertSame(['one@platform.test', 'two@platform.test'], User::query()->orderBy('email')->pluck('email')->all());
        $this->assertTrue($this->admin('one@platform.test')->isSuperAdmin());
        $this->assertTrue(Hash::check('a-long-first-password', $this->admin('one@platform.test')->password));
        $this->assertSame('Platform Admin', $this->admin('two@platform.test')->name);
        $this->assertNull(User::query()->whereIn('email', ['admin@shopos.test', 'admin@trueserve.app'])->first());
    }

    public function test_on_a_live_box_a_changed_password_survives_a_seed(): void
    {
        $this->onALiveBoxWith([['name' => 'Owner One', 'email' => 'one@platform.test', 'password' => 'a-long-first-password']]);
        (new SuperAdminSeeder)->run();
        $this->admin('one@platform.test')->update(['password' => 'chosen-at-the-first-sign-in']);

        (new SuperAdminSeeder)->run();

        $now = $this->admin('one@platform.test')->password;
        $this->assertTrue(Hash::check('chosen-at-the-first-sign-in', $now), 'the seed put the .env password back');
        $this->assertSame(1, User::query()->where('email', 'one@platform.test')->count());
    }

    public function test_on_a_live_box_a_short_password_makes_no_account(): void
    {
        $this->onALiveBoxWith([['name' => 'Owner One', 'email' => 'one@platform.test', 'password' => 'short']]);

        (new SuperAdminSeeder)->run();

        $this->assertSame(0, User::query()->count());
    }

    public function test_on_a_live_box_with_nothing_in_env_nothing_is_made(): void
    {
        $this->onALiveBoxWith([['name' => 'Super Admin', 'email' => null, 'password' => null]]);

        (new SuperAdminSeeder)->run();

        $this->assertSame(0, User::query()->count());
    }

    public function test_on_a_laptop_a_seed_still_puts_the_test_admin_right(): void
    {
        (new SuperAdminSeeder)->run();
        $this->admin('admin@shopos.test')->update(['password' => 'something-a-test-left-behind']);

        (new SuperAdminSeeder)->run();

        $this->assertTrue(Hash::check('password', $this->admin('admin@shopos.test')->password));
    }
}
