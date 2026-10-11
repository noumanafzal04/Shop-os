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
        /**
         * The laptop's admin — every e2e run signs in as it.
         *
         * ON A LIVE BOX IT IS MADE ONCE AND LEFT. This wrote `password` back
         * on every `db:seed`, so the one thing the launch checklist asks for
         * — change that password — was undone by the next person to seed
         * anything. A laptop keeps the old behaviour on purpose: there, a
         * re-seed is how an admin a test has broken is put right.
         */
        $laptopAdmin = [
            'name' => 'Super Admin',
            'password' => 'password', // hashed by cast; `shopos:readiness` refuses a live box that still has it
            'role' => UserRole::SuperAdmin,
            'status' => UserStatus::Active,
            'tenant_id' => null,
            'email_verified_at' => now(),
        ];

        app()->environment('production')
            ? User::query()->firstOrCreate(['email' => 'admin@shopos.test'], $laptopAdmin)
            : User::query()->updateOrCreate(['email' => 'admin@shopos.test'], $laptopAdmin);

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
