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
 * admin that a test or a person has broken is put right.
 */
class ASeedDoesNotPutAPasswordBackTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $email): User
    {
        return User::query()->where('email', $email)->firstOrFail();
    }

    public function test_on_a_live_box_a_changed_password_survives_a_seed(): void
    {
        $this->app['env'] = 'production';

        // Run as the class, not through `db:seed`: on a live box that command
        // stops to ask "are you sure?", and nobody is here to answer.
        (new SuperAdminSeeder)->run();
        foreach (['admin@shopos.test', 'admin@trueserve.app'] as $email) {
            $this->admin($email)->update(['password' => 'chosen-by-whoever-runs-this-box']);
        }

        (new SuperAdminSeeder)->run();

        foreach (['admin@shopos.test' => 'password', 'admin@trueserve.app' => 'Admin@123'] as $email => $published) {
            $now = $this->admin($email)->password;
            $this->assertTrue(Hash::check('chosen-by-whoever-runs-this-box', $now), "{$email} lost the password it was given");
            $this->assertFalse(Hash::check($published, $now), "{$email} is back on the password written in the repository");
        }
    }

    public function test_on_a_laptop_a_seed_still_puts_the_test_admin_right(): void
    {
        (new SuperAdminSeeder)->run();
        $this->admin('admin@shopos.test')->update(['password' => 'something-a-test-left-behind']);

        (new SuperAdminSeeder)->run();

        $this->assertTrue(Hash::check('password', $this->admin('admin@shopos.test')->password));
    }
}
