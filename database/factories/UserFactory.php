<?php

namespace Database\Factories;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * The current password being used by the factory.
     */
    protected static ?string $password;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'phone' => fake()->unique()->e164PhoneNumber(),
            'email_verified_at' => now(),
            'password' => static::$password ??= Hash::make('password'),
            'role' => UserRole::Customer,
            'status' => UserStatus::Active,
            'remember_token' => Str::random(10),
        ];
    }

    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }

    public function superAdmin(): static
    {
        return $this->state(fn (array $attributes) => [
            'role' => UserRole::SuperAdmin,
            'tenant_id' => null,
        ]);
    }

    public function shopOwner(?Tenant $tenant = null): static
    {
        return $this->state(fn (array $attributes) => [
            'role' => UserRole::ShopOwner,
            'tenant_id' => $tenant?->id ?? Tenant::factory(),
        ]);
    }

    public function suspended(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => UserStatus::Suspended,
        ]);
    }

    public function adminStaff(array $permissions = []): static
    {
        return $this->state(fn (array $attributes) => [
            'role' => UserRole::AdminStaff,
            'tenant_id' => null,
            'permissions' => $permissions,
        ]);
    }

    public function tenantStaff(?Tenant $tenant = null, array $permissions = []): static
    {
        return $this->state(fn (array $attributes) => [
            'role' => UserRole::Staff,
            'tenant_id' => $tenant?->id ?? Tenant::factory(),
            'permissions' => $permissions,
        ]);
    }
}
