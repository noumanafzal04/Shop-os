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
            // Shift discipline is opt-in: enforcing it by default would stop a
            // one-person shop from selling the day the check went live.
            ->assertJsonPath('data.pos_require_shift', false);
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

    // ── Branding: a shop can wear its own colours ────────────────────

    /** Unset means "follow ShopOS" — we never persist the house default. */
    public function test_brand_colours_default_to_null(): void
    {
        $this->actingAsUser($this->owner)->getJson('/api/v1/shop/settings')
            ->assertOk()
            ->assertJsonPath('data.theme_primary', null)
            ->assertJsonPath('data.theme_secondary', null);
    }

    public function test_shop_can_set_and_clear_its_brand_colour(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'theme_primary' => '#12B76A',
            'theme_secondary' => '#7a5af8',
        ])->assertOk()->assertJsonPath('data.theme_primary', '#12B76A');

        $this->assertSame('#12B76A', $this->shop->fresh()->setting('theme_primary'));

        // Clearing hands the tenant back to the product default.
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'theme_primary' => null,
        ])->assertOk()->assertJsonPath('data.theme_primary', null);
    }

    /** Sidebar surface + surface-tint strength, chosen in the Appearance canvas. */
    public function test_appearance_defaults_and_updates(): void
    {
        $this->actingAsUser($this->owner)->getJson('/api/v1/shop/settings')
            ->assertOk()
            ->assertJsonPath('data.theme_tint', 'subtle')
            ->assertJsonPath('data.theme_sidebar', 'light');

        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'theme_tint' => 'strong',
            'theme_sidebar' => 'dark',
        ])->assertOk()
            ->assertJsonPath('data.theme_tint', 'strong')
            ->assertJsonPath('data.theme_sidebar', 'dark');
    }

    /** Only the three known options each — anything else would break the shell. */
    public function test_appearance_options_are_constrained(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'theme_tint' => 'neon',
            'theme_sidebar' => 'rainbow',
        ])->assertStatus(422)
            ->assertJsonStructure(['errors' => ['theme_tint', 'theme_sidebar']]);
    }

    /**
     * The panel expands this hex into a whole colour ramp, so anything that
     * isn't a 6-digit hex has to be refused at the door — a bad value would
     * render an unreadable UI rather than fail loudly.
     */
    public function test_brand_colour_must_be_a_six_digit_hex(): void
    {
        foreach (['red', '#fff', '12B76A', '#12B76AA', 'javascript:alert(1)'] as $bad) {
            $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
                'theme_primary' => $bad,
            ])->assertStatus(422)->assertJsonStructure(['errors' => ['theme_primary']]);
        }

        // …and the shop is left untouched by the rejected attempts.
        $this->assertNull($this->shop->fresh()->setting('theme_primary'));
    }
}
