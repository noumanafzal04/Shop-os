<?php

namespace Database\Factories;

use App\Enums\TenantStatus;
use App\Models\Tenant;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Tenant>
 */
class TenantFactory extends Factory
{
    public function definition(): array
    {
        $name = fake()->unique()->company();

        return [
            'business_name' => $name,
            'slug' => Str::slug($name).'-'.Str::lower(Str::random(6)),
            'email' => fake()->unique()->companyEmail(),
            'phone' => fake()->unique()->e164PhoneNumber(),
            'business_category' => fake()->randomElement(['grocery', 'electronics', 'clothing', 'pharmacy', 'restaurant']),
            'status' => TenantStatus::Active,
            'online_shop_enabled' => false,
        ];
    }

    public function suspended(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => TenantStatus::Suspended,
        ]);
    }

    public function onlineShop(): static
    {
        return $this->state(fn (array $attributes) => [
            'online_shop_enabled' => true,
        ]);
    }

    /** A post-setup shop with every module switched on. */
    public function provisioned(): static
    {
        return $this->state(fn (array $attributes) => [
            'features' => array_fill_keys(\App\Support\BusinessTypes::FEATURES, true),
        ]);
    }
}
