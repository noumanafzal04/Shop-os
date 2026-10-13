<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SaleItem;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * A DESIGN ON SALE IS ON SALE IN EVERY SIZE THAT FOLLOWS IT.
 *
 * Zari Clothing put a lawn suit on sale: 5,490, now 4,990. The products list
 * and the till's tile said 4,990; the bill for a Medium said 5,490 — a size's
 * own price was charged, and the design's sale never reached it.
 *
 * Every size carries a price (the size grid fills it with the design's), so
 * "a size with no price of its own" is one priced the same as the design. The
 * user's rule (2026-10-13): that size takes the design's selling price, sale
 * included. A size priced differently — an XL at 5,990 — keeps its own.
 */
class ASizeOnSaleRingsUpAtTheSalePriceTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'online_shop_enabled' => true, 'city_id' => $city->id,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** A lawn suit at 5,490, on sale at 4,990, in M (the design's price) and XL (its own). */
    private function suit(): array
    {
        return $this->asOwner()->postJson('/api/v1/products', [
            'name' => 'Lawn Suit', 'item_type' => 'physical_product', 'price' => 5490, 'discount_price' => 4990,
            'track_inventory' => true, 'visible_in_marketplace' => true,
            'variants' => [
                ['name' => 'M', 'price' => 5490, 'stock_quantity' => 10],
                ['name' => 'XL', 'price' => 5990, 'stock_quantity' => 10],
            ],
        ])->assertCreated()->json('data');
    }

    private function sizeOf(array $design, string $name): string
    {
        return collect($design['variants'])->firstWhere('name', $name)['id'];
    }

    private function rung(array $design, string $size): array
    {
        return $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $design['id'], 'variant_id' => $this->sizeOf($design, $size), 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 6000,
        ])->assertCreated()->json('data');
    }

    private function linePrice(string $saleId): float
    {
        return (float) SaleItem::withoutTenancy()->where('sale_id', $saleId)->sole()->unit_price;
    }

    // ── the rule ────────────────────────────────────────────────────────

    public function test_the_rule(): void
    {
        $onSale = new Product(['price' => 5490, 'discount_price' => 4990]);

        $this->assertSame(4990.0, $onSale->priceOfSize(new ProductVariant(['price' => 5490])), 'a size priced as the design did not follow the design\'s sale');
        $this->assertSame(5990.0, $onSale->priceOfSize(new ProductVariant(['price' => 5990])), 'a size with its own price lost it');
        $this->assertSame(4500.0, $onSale->priceOfSize(new ProductVariant(['price' => 4500])), 'a size priced below the sale was raised to it');
        $this->assertSame(5490.0, (new Product(['price' => 5490]))->priceOfSize(new ProductVariant(['price' => 5490])), 'a design not on sale changed a size\'s price');
        // A "sale" above the price is not a sale (Product::sellingPrice).
        $this->assertSame(5490.0, (new Product(['price' => 5490, 'discount_price' => 6000]))->priceOfSize(new ProductVariant(['price' => 5490])));
    }

    // ── every place a size is priced ────────────────────────────────────

    public function test_at_the_till_a_size_that_follows_the_design_is_charged_the_sale_price(): void
    {
        $suit = $this->suit();

        $m = $this->rung($suit, 'M');
        $this->assertSame(4990.0, $this->linePrice($m['id']), 'the list said 4,990 and the bill charged 5,490');
        $this->assertSame(4990.0, (float) $m['total']);

        $this->assertSame(5990.0, $this->linePrice($this->rung($suit, 'XL')['id']), 'a size with its own price was given the design\'s sale');
    }

    public function test_when_the_sale_ends_the_size_goes_back_to_full_price(): void
    {
        $suit = $this->suit();
        Product::withoutTenancy()->whereKey($suit['id'])->update(['discount_price' => null]);

        $this->assertSame(5490.0, $this->linePrice($this->rung($suit, 'M')['id']));
    }

    public function test_on_a_phone_order(): void
    {
        $suit = $this->suit();
        $order = $this->asOwner()->postJson('/api/v1/orders', [
            'channel' => 'phone', 'customer_name' => 'Mrs. Khan', 'customer_phone' => '03001112233', 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $suit['id'], 'variant_id' => $this->sizeOf($suit, 'M'), 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertSame(4990.0, (float) DB::table('order_items')->where('order_id', $order['id'])->value('unit_price'));
    }

    public function test_on_a_tab(): void
    {
        $suit = $this->suit();
        $table = DiningTable::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'T1', 'seats' => 4]);
        $tab = $this->asOwner()->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $table->id, 'guest_count' => 1,
        ])->assertCreated()->json('data');
        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
            'items' => [['product_id' => $suit['id'], 'variant_id' => $this->sizeOf($suit, 'M'), 'quantity' => 1]],
        ])->assertSuccessful();

        $this->assertSame(4990.0, (float) DB::table('restaurant_ticket_items')->where('ticket_id', $tab['id'])->value('unit_price'));
    }

    public function test_on_a_quotation(): void
    {
        $suit = $this->suit();
        $doc = $this->asOwner()->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'expires_at' => now()->addDays(7)->toDateString(),
            'items' => [['product_id' => $suit['id'], 'variant_id' => $this->sizeOf($suit, 'M'), 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertSame(4990.0, (float) $doc['total'], 'a quotation priced the size above what the till charges');
    }

    public function test_the_online_store_shows_what_it_will_charge(): void
    {
        $this->suit();
        $items = $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}/products")->assertOk()->json('data');
        $sizes = collect(collect($items)->firstWhere('name', 'Lawn Suit')['variants'])->pluck('price', 'name');

        $this->assertSame(4990.0, (float) $sizes['M'], 'the online store showed a customer 5,490 for a size on sale');
        $this->assertSame(5990.0, (float) $sizes['XL']);
    }

    // ── and nobody prices a size by reading its row again ───────────────

    public function test_no_selling_path_charges_a_sizes_row_price(): void
    {
        $offenders = [];
        foreach (['Actions', 'Services', 'Http/Controllers'] as $dir) {
            foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path($dir))) as $file) {
                if ($file->isFile() && $file->getExtension() === 'php'
                    && preg_match('/\(float\)\s*\$variant->price\b/', (string) file_get_contents($file->getPathname()))) {
                    $offenders[] = str_replace(app_path().'/', '', $file->getPathname());
                }
            }
        }

        $this->assertSame([], $offenders, 'these charge a size its row price, which never carries the design\'s sale. Ask Product::priceOfSize.');
    }
}
