<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Database\Seeder;

class SuperAdminSeeder extends Seeder
{
    public function run(): void
    {
        User::query()->updateOrCreate(
            ['email' => 'admin@shopos.test'],
            [
                'name' => 'Super Admin',
                'password' => 'password', // hashed by cast; change in production
                'role' => UserRole::SuperAdmin,
                'status' => UserStatus::Active,
                'tenant_id' => null,
                'email_verified_at' => now(),
            ],
        );

        /**
         * The platform's account at the product's own address.
         *
         * MADE ONCE, NEVER RE-SET. `firstOrCreate`, where the account above is
         * `updateOrCreate`: this seeder runs on every `db:seed`, and a seeder
         * that writes the password each time puts a known one back on a live
         * administrator whenever somebody seeds. Whoever changes this
         * password keeps the one they chose.
         *
         * `Admin@123` is in this file and therefore in the repository. It is
         * a first password, to be changed at the first sign-in on any server
         * a stranger can reach.
         */
        User::query()->firstOrCreate(
            ['email' => 'admin@trueserve.app'],
            [
                // The product's name is written once — `APP_NAME`.
                'name' => config('app.name').' Admin',
                'password' => 'Admin@123',
                'role' => UserRole::SuperAdmin,
                'status' => UserStatus::Active,
                'tenant_id' => null,
                'email_verified_at' => now(),
            ],
        );
    }
}
