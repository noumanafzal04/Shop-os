<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class SettingsConfigTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_settings_returns_defaults(): void
    {
        $this->actingAsUser($this->owner)->getJson('/api/v1/shop/settings')
            ->assertOk()
            ->assertJsonPath('data.currency_symbol', 'Rs')
            ->assertJsonPath('data.invoice_footer', 'Thank you for your business!')
            ->assertJsonPath('data.pos_require_shift', true);
    }

    public function test_partial_update_merges_over_defaults(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'currency' => 'AED', 'currency_symbol' => 'د.إ', 'default_tax_rate' => 5,
            'invoice_footer' => 'Come again!',
        ])->assertOk()->assertJsonPath('data.currency', 'AED')->assertJsonPath('data.default_tax_rate', 5);

        // Untouched keys keep their defaults.
        $this->actingAsUser($this->owner)->getJson('/api/v1/shop/settings')
            ->assertJsonPath('data.pos_default_payment', 'cash')
            ->assertJsonPath('data.invoice_footer', 'Come again!');

        $this->assertSame('د.إ', $this->shop->fresh()->setting('currency_symbol'));
    }

    public function test_update_validates(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'default_tax_rate' => 150, 'receipt_width' => 'giant',
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['default_tax_rate', 'receipt_width']]);
    }

    public function test_staff_without_settings_permission_cannot_update(): void
    {
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $this->actingAsUser($staff)->putJson('/api/v1/shop/settings', ['currency_symbol' => '$'])
            ->assertStatus(403);
        // …but may read.
        $this->actingAsUser($staff)->getJson('/api/v1/shop/settings')->assertOk();
    }

    public function test_invoice_reflects_currency_and_footer(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'currency_symbol' => 'AED', 'invoice_footer' => 'Visit us again',
        ])->assertOk();

        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Item', 'price' => 100, 'stock_quantity' => 10, 'track_inventory' => true,
        ]);
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $product->id, 'quantity' => 1]], 'amount_paid' => 100,
        ])->json('data');

        $html = $this->actingAsUser($this->owner)->get("/api/v1/sales/{$sale['id']}/invoice")->getContent();
        $this->assertStringContainsString('AED', $html);
        $this->assertStringContainsString('Visit us again', $html);
    }
}
