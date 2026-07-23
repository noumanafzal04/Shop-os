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
    }
}
