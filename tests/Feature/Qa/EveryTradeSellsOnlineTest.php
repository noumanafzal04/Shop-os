<?php

namespace Tests\Feature\Qa;

use App\Enums\OrderStatus;
use App\Enums\TenantStatus;
use App\Models\City;
use App\Models\Order;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ItemTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * ONE FLOW, RUN ONCE FOR EVERY TRADE THAT SELLS ONLINE.
 *
 * ── Why this test exists ────────────────────────────────────────────────
 *
 * The online side is covered — `OrdersTest`, `MarketplaceTest`,
 * `OnlineOrderParityTest`, `TheOrderQueueTest` and a dozen more. Counted, they
 * are seventy-odd cases, and SIXTY-EIGHT of them are one shop: a restaurant,
 * or the retail shop `OrdersTest` builds. The flow is proven; the flow proven
 * for a MART, a pharmacy, a hardware store or a wholesaler is proven by
 * inference.
 *
 * Inference is exactly what fails here, because a trade is not a label. It
 * decides the default feature set, whether inventory is tracked at all, which
 * item type its goods are, what units it uses, and whether it appears in the
 * marketplace in the first place. Each of those has silently emptied a screen
 * before.
 *
 * So: the same journey — find the shop, read its card, open it, read its
 * goods, order, have the shop accept, see it back — walked once per trade,
 * against the real endpoints.
 *
 * ── The two groups, and why the closed one is tested at all ─────────────
 *
 * Some trades do not sell online: a workshop, a clinic, a salon, a petrol
 * station, the finance manager. `BusinessTypes::defaultFeatures` leaves
 * `marketplace` false for them, and that is the design.
 *
 * "Does not sell online" has two possible shapes, though, and only one of them
 * is correct: INVISIBLE AND REFUSED, or invisible and 500. The second is what
 * a fence built out of a missing default looks like the first time somebody
 * flips `online_shop_enabled` from the panel, and it is a trade's whole
 * customer experience. So the refusal is asserted rather than assumed.
 */
class EveryTradeSellsOnlineTest extends TestCase
{
    use RefreshDatabase;

    private City $city;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->city = City::query()->create([
            'name' => 'Lahore', 'is_active' => true,
            'latitude' => 31.5204, 'longitude' => 74.3587,
        ]);
        $this->customer = User::factory()->create();
    }

    /**
     * Every trade the app offers, and whether the marketplace is part of it.
     *
     * Read from `BusinessTypes` rather than listed here, so a new trade joins
     * this test by existing. A hard-coded list would have to be remembered,
     * and the whole class of bug being caught is a trade nobody remembered.
     *
     * @return array<string, array{string}>
     */
    public static function trades(): array
    {
        return collect(BusinessTypes::all())
            ->keys()
            ->mapWithKeys(fn (string $code) => [$code => [$code]])
            ->all();
    }

    #[DataProvider('trades')]
    public function test_the_whole_online_journey_works_for_this_trade(string $trade): void
    {
        $features = BusinessTypes::defaultFeatures($trade);
        $sellsOnline = ($features['marketplace'] ?? false) && ($features['products'] ?? false);

        $shop = $this->shop($trade, $features);
        $product = $this->product($shop, $trade);

        if (! $sellsOnline) {
            $this->assertStaysOffTheMarketplace($shop, $product);

            return;
        }

        // ── 1. The shopper finds it ──────────────────────────────────
        $listed = $this->getJson('/api/v1/marketplace/shops?'.http_build_query($this->pin()))
            ->assertOk()->json('data');

        $this->assertContains(
            $shop->slug,
            array_column($listed, 'slug'),
            "a {$trade} shop is not in the shop list",
        );

        // ── 2. The card says enough to decide on ─────────────────────
        $card = collect($listed)->firstWhere('slug', $shop->slug);
        $this->assertNotNull($card['business_type'], "{$trade}: card has no trade");
        $this->assertTrue($card['is_open_now'], "{$trade}: open all week and reads as shut");
        $this->assertTrue($card['delivers'], "{$trade}: delivery on and the card says no");

        // ── 3. The shop page, and its goods ──────────────────────────
        $this->getJson("/api/v1/marketplace/shops/{$shop->slug}")
            ->assertOk()
            ->assertJsonPath('data.slug', $shop->slug);

        $goods = $this->getJson("/api/v1/marketplace/shops/{$shop->slug}/products")
            ->assertOk()->json('data');

        $this->assertContains(
            $product->id,
            array_column($goods, 'id'),
            "{$trade}: the product is not listed on its own shop page",
        );

        // ── 4. The order ─────────────────────────────────────────────
        $placed = $this->asCustomer()->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => '12 Main Boulevard, Gulberg',
            'latitude' => $this->pin()['lat'],
            'longitude' => $this->pin()['lng'],
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        $this->assertSame('pending', $placed['status'], "{$trade}: a new order is not pending");
        // SERVER-AUTHORITATIVE, stated per trade: the price came from the row,
        // and the delivery fee from the shop.
        $this->assertSame('2000.00', $placed['subtotal'], "{$trade}: subtotal is not 2 × 1000");
        $this->assertSame('150.00', $placed['delivery_fee'], "{$trade}: delivery fee lost");

        // ── 5. The shop sees it and accepts ──────────────────────────
        $owner = User::factory()->shopOwner($shop)->create();

        $queue = $this->as($owner)->getJson('/api/v1/orders')->assertOk()->json('data');
        $this->assertContains(
            $placed['id'],
            array_column($queue, 'id'),
            "{$trade}: the order never reached the shop's queue",
        );

        $this->as($owner)
            ->postJson("/api/v1/orders/{$placed['id']}/advance", ['status' => 'confirmed'])
            ->assertOk();

        // ── 6. …and the customer is told ─────────────────────────────
        $this->asCustomer()
            ->getJson("/api/v1/customer/orders/{$placed['id']}")
            ->assertOk()
            ->assertJsonPath('data.status', 'confirmed');

        $this->assertSame(
            OrderStatus::Confirmed,
            Order::withoutTenancy()->find($placed['id'])->status,
            "{$trade}: accepted in the API and not in the database",
        );
    }

    /**
     * THE REFUSALS, ASKED OF EVERY TRADE.
     *
     * Each of these is already tested once, somewhere, against one shop — a
     * restaurant or the retail fixture in `OrdersTest`. That proves the rule
     * exists; it does not prove a PHARMACY refuses an out-of-area delivery,
     * because the fences read `features`, `settings` and the item type, and
     * all three fork by trade.
     *
     * The error CODE is asserted rather than the message. A refusal the app
     * cannot tell apart from any other 422 is a refusal the app cannot
     * explain, and every one of these has its own thing to say.
     */
    #[DataProvider('trades')]
    public function test_the_refusals_are_the_same_whatever_the_trade(string $trade): void
    {
        $features = BusinessTypes::defaultFeatures($trade);
        if (! (($features['marketplace'] ?? false) && ($features['products'] ?? false))) {
            $this->markTestSkipped("{$trade} does not sell online");
        }

        $shop = $this->shop($trade, $features);
        $product = $this->product($shop, $trade);

        // ── Too far ──────────────────────────────────────────────────
        // Karachi, from a shop in Lahore with a 20 km radius.
        $this->order($shop, $product, [
            'latitude' => 24.8607, 'longitude' => 67.0011,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'OUT_OF_DELIVERY_AREA');

        // ── Below the shop's minimum ─────────────────────────────────
        $this->setting($shop, ['min_order_amount' => 5000]);
        $this->order($shop, $product)
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'MIN_ORDER_AMOUNT');
        $this->setting($shop, ['min_order_amount' => null]);

        // ── Delivery switched off ────────────────────────────────────
        $this->setting($shop, ['delivery_enabled' => false]);
        $this->order($shop, $product)
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'DELIVERY_DISABLED');
        // …and pickup still works, because "no delivery" is not "closed".
        $this->order($shop, $product, ['fulfillment_type' => 'pickup', 'delivery_address' => null])
            ->assertCreated();
        $this->setting($shop, ['delivery_enabled' => true]);

        // ── Shut ─────────────────────────────────────────────────────
        $shop->forceFill(['business_hours' => [[
            'day' => (now()->dayOfWeek + 3) % 7, 'open' => '09:00', 'close' => '17:00',
        ]]])->save();
        $this->order($shop, $product)
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'SHOP_CLOSED');
        $shop->forceFill(['business_hours' => $this->alwaysOpen()])->save();

        // ── Taken off the marketplace ────────────────────────────────
        $product->forceFill(['visible_in_marketplace' => false])->save();
        $this->order($shop, $product)
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'PRODUCT_UNAVAILABLE');
        $product->forceFill(['visible_in_marketplace' => true])->save();

        // ── Somebody else's product ──────────────────────────────────
        $other = $this->shop($trade, $features);
        $theirs = $this->product($other, $trade);
        $this->order($shop, $theirs)
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'PRODUCT_UNAVAILABLE');
    }

    /**
     * THE PRICE COMES FROM THE ROW, for every trade.
     *
     * Standing rule: HTTP never supplies `unit_price`, `tax` or `line_total`.
     * Asked per trade because a trade decides the item type, and the item type
     * decides which of price, variant price and pack price is the one that
     * counts.
     */
    #[DataProvider('trades')]
    public function test_a_posted_price_is_ignored_whatever_the_trade(string $trade): void
    {
        $features = BusinessTypes::defaultFeatures($trade);
        if (! (($features['marketplace'] ?? false) && ($features['products'] ?? false))) {
            $this->markTestSkipped("{$trade} does not sell online");
        }

        $shop = $this->shop($trade, $features);
        $product = $this->product($shop, $trade);

        $order = $this->asCustomer()->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug,
            'fulfillment_type' => 'pickup',
            'items' => [[
                'product_id' => $product->id,
                'quantity' => 1,
                // All three, and none of them may be believed.
                'unit_price' => 1,
                'line_total' => 1,
                'tax' => 0,
            ]],
        ])->assertCreated()->json('data');

        $this->assertSame('1000.00', $order['subtotal'], "{$trade}: a posted price was believed");
    }

    /**
     * A trade with no marketplace is invisible AND says no.
     *
     * Both halves matter. Invisible alone is a fence that only holds while
     * nobody guesses the slug, and the slug is the shop's name.
     */
    private function assertStaysOffTheMarketplace(Tenant $shop, Product $product): void
    {
        $listed = $this->getJson('/api/v1/marketplace/shops?'.http_build_query($this->pin()))
            ->assertOk()->json('data');

        $this->assertNotContains(
            $shop->slug,
            array_column($listed, 'slug'),
            "{$shop->business_type} has no marketplace and is listed anyway",
        );

        // Named directly, which is the door a fence built out of a list misses.
        $this->getJson("/api/v1/marketplace/shops/{$shop->slug}")->assertNotFound();

        // And the order is REFUSED rather than fatal. 404 because the shop is
        // not a marketplace shop; what must never happen is a 500.
        $this->asCustomer()->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug,
            'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertNotFound();

        $this->assertSame(0, Order::withoutTenancy()->count());
    }

    // ── Doing it ────────────────────────────────────────────────────

    private function order(Tenant $shop, Product $product, array $overrides = []): TestResponse
    {
        return $this->asCustomer()->postJson('/api/v1/customer/orders', array_merge([
            'shop_slug' => $shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => '12 Main Boulevard, Gulberg',
            'latitude' => $this->pin()['lat'],
            'longitude' => $this->pin()['lng'],
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ], $overrides));
    }

    /**
     * Merge ONE key into the settings JSON.
     *
     * `forceFill(['settings' => [...]])` replaces the whole column, which has
     * already wiped a delivery radius mid-test once. Read, merge, write.
     */
    private function setting(Tenant $shop, array $patch): void
    {
        $shop->forceFill(['settings' => array_merge($shop->settings ?? [], $patch)])->save();
        $shop->refresh();
    }

    private function alwaysOpen(): array
    {
        return array_map(
            fn (int $d) => ['day' => $d, 'open' => '00:00', 'close' => '23:59'],
            range(0, 6),
        );
    }

    // ── Fixtures ────────────────────────────────────────────────────

    /** Roughly Gulberg — where the shopper is standing. */
    private function pin(): array
    {
        return ['lat' => 31.5204, 'lng' => 74.3587];
    }

    private function shop(string $trade, array $features): Tenant
    {
        return Tenant::factory()->create([
            'business_name' => ucfirst($trade).' Test Shop',
            'business_type' => $trade,
            'features' => $features,
            'city_id' => $this->city->id,
            'latitude' => 31.5254,
            'longitude' => 74.3637,
            'status' => TenantStatus::Active,
            'setup_completed' => true,
            'online_shop_enabled' => true,
            'is_demo' => false,
            'delivery_fee' => 150,
            'business_hours' => $this->alwaysOpen(),
            'settings' => [
                'delivery_enabled' => true,
                'pickup_enabled' => true,
                'delivery_radius_km' => 20,
            ],
        ]);
    }

    /**
     * One thing to sell, of the kind this trade actually sells.
     *
     * The item type is not decoration — it decides whether inventory can be
     * tracked at all, so a food item created as a physical product with five
     * in stock is a fixture that proves nothing about a restaurant.
     */
    private function product(Tenant $shop, string $trade): Product
    {
        $itemType = match ($trade) {
            'food', 'restaurant' => ItemTypes::FOOD,
            'pharmacy', 'clinic' => ItemTypes::MEDICINE,
            default => ItemTypes::PHYSICAL,
        };

        $tracks = ItemTypes::defaultTracksInventory($itemType);

        return Product::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'type' => 'product',
            'item_type' => $itemType,
            'name' => 'Test Item',
            'price' => 1000,
            'cost' => 700,
            'track_inventory' => $tracks,
            'stock_quantity' => $tracks ? 50 : 0,
            'is_active' => true,
            'visible_in_marketplace' => true,
        ]);
    }

    private function asCustomer(): static
    {
        return $this->as($this->customer);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
