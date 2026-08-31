<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * ONE SHOP'S DAY, AND THEN EVERY SCREEN ASKED THE SAME QUESTION.
 *
 * ── Why this exists when every module already has tests ─────────────────
 *
 * The supplier `Pay` button settled nothing for weeks inside a green suite,
 * and the reason was not a missing test. `CashMovementTest` had been posting to
 * that endpoint since August. The line was COVERED. What no test did was ask
 * what the balance said afterwards.
 *
 * That is the shape of every miss this codebase has had:
 *
 *   supplier Pay          the endpoint answered 201   nobody asked if the balance moved
 *   sized parent adjust   the endpoint answered 201   nobody asked if the shelf moved
 *   low stock             each screen answered        nobody asked if they agreed
 *   sold-out / 86         the till refused            nobody asked the other two doors
 *   discount ceiling      the till capped it          nobody asked the online door
 *
 * So this file is not a deeper test of any module. It is a whole DAY —
 * bought, sold, refunded, banked and closed off — followed by a chorus: the
 * questions a shopkeeper actually asks at ten at night, put to every screen
 * that can answer them, with the answers required to match.
 *
 * ── The expectation is the test's own, not the code's ───────────────────
 *
 * A chorus alone catches disagreement, not a shared mistake: four screens
 * reading one broken query agree perfectly. So the day keeps its OWN books as
 * it goes — every rupee it put in the drawer, every rupee it took out — and the
 * screens are measured against that, never against each other alone.
 *
 * ── Why the failures are collected, not thrown ──────────────────────────
 *
 * `assertEquals` on the first screen ends the test there, and the interesting
 * fact about a disagreement is WHICH screens disagree. So each question appends
 * to `$wrong` and the assertion at the end prints the lot.
 */
final class ADayInTheShopTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    // ── The day's own books ─────────────────────────────────────────
    //
    // Kept by the TEST, in the order the day happened, so that a figure on a
    // screen is compared with something the product had no hand in computing.

    private float $openingFloat = 0.0;

    private float $intoTheDrawer = 0.0;

    private float $outOfTheDrawer = 0.0;

    /** Gross of every sale rung, whatever the tender. A refund does not reduce it. */
    private float $rung = 0.0;

    private float $refunded = 0.0;

    private float $billsPaid = 0.0;

    private ?string $dayId = null;

    private ?string $sessionId = null;

    private ?string $supplierId = null;

    private ?string $customerId = null;

    /**
     * What each trade puts on the counter, and what it costs.
     *
     * Derived nowhere else: `EveryTradeSellsTest` keeps its own list because it
     * asks a different question of it. Two lists is the risk, and it is the
     * lesser one — a shared provider would tie a shallow chain and a whole day
     * to the same fixture, and the day needs a cost price to buy at.
     *
     * @return array<string, array{0: string, 1: string, 2: float, 3: float}>
     */
    public static function trades(): array
    {
        return [
            'a grocery' => ['mart', 'physical_product', 250.0, 180.0],
        ];
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    // ── THE DAY ─────────────────────────────────────────────────────

    #[DataProvider('trades')]
    public function test_a_days_trading_reads_the_same_on_every_screen(
        string $type,
        string $itemType,
        float $price,
        float $cost,
    ): void {
        $this->openTheShop($type);
        $product = $this->cardTheItem($itemType, $price, $cost);

        $this->buyStock($product, qty: 40, unitCost: $cost);
        $this->openTheTill(float: 5000);

        // Three tenders, because the drawer must tell them apart. A card sale
        // and a khata sale are both takings and neither is cash, and the
        // commonest arithmetic bug in a till is treating the sale total as the
        // cash total.
        $cashSale = $this->sell($product, qty: 4, price: $price, tender: 'cash');
        $this->sell($product, qty: 2, price: $price, tender: 'card');
        $this->sellOnKhata($product, qty: 3, price: $price);

        // One bag comes back torn, refunded in cash out of the same drawer.
        $this->refundOneLine($cashSale, $price);

        $this->takeKhataPayment(300);
        $this->paySupplier(4000);
        $this->payABill(1200);

        $this->countTheDrawer();
        $this->closeTheDay();

        // ── THE CHORUS ──────────────────────────────────────────────
        $wrong = [];
        $this->whatDidTheShopTake($wrong);
        $this->whatWentBackOut($wrong);
        $this->whatShouldBeInTheDrawer($wrong);

        $this->assertSame([], $wrong, "\n".implode("\n", $wrong)."\n");
    }

    // ── The questions ───────────────────────────────────────────────

    /**
     * Q1 — what did the shop take today?
     *
     * Four screens compute this from three different tables, and an owner will
     * look at whichever is nearest. Gross of refunds on every one of them: a
     * refunded sale still happened, and netting it at source hides both events.
     */
    private function whatDidTheShopTake(array &$wrong): void
    {
        $today = now()->toDateString();

        $this->agree($wrong, 'what the shop took', $this->rung, [
            'the day, closed off' => $this->day()['sales_total'],
            'the cashbook' => $this->cashbookToday()['sales_revenue'],
            'the sales report' => $this->read("/api/v1/reports/summary?from={$today}&to={$today}")['totals']['revenue'],
            'the dashboard' => $this->read('/api/v1/dashboard')['today']['revenue'],
        ]);
    }

    /**
     * Q1b — and what went back out over the counter?
     *
     * The other half of Q1, and the reason revenue is allowed to be gross. A
     * screen that reports the takings without the refunds beside them is not
     * reporting a smaller number, it is reporting a WRONG one — and the sales
     * report and the dashboard had no refunds line at all, so their profit was
     * struck as though nothing had ever been handed back.
     */
    private function whatWentBackOut(array &$wrong): void
    {
        $today = now()->toDateString();

        $this->agree($wrong, 'what went back out', $this->refunded, [
            'the cashbook' => $this->cashbookToday()['refunds'],
            'the sales report' => $this->read("/api/v1/reports/summary?from={$today}&to={$today}")['totals']['refunds'],
            'the dashboard' => $this->read('/api/v1/dashboard')['today']['refunds'],
        ]);
    }

    /**
     * Q2 — what should be in the drawer?
     *
     * The one figure a cashier is personally measured against. It is not the
     * takings: a card sale never touched the drawer, a khata sale never touched
     * it, and a supplier paid in cash emptied it.
     */
    private function whatShouldBeInTheDrawer(array &$wrong): void
    {
        $expected = round($this->openingFloat + $this->intoTheDrawer - $this->outOfTheDrawer, 2);

        $this->agree($wrong, 'what should be in the drawer', $expected, [
            'the Z-read' => $this->read("/api/v1/pos/sessions/{$this->sessionId}/z-report")['session']['expected_cash'],
            'the day, closed off' => $this->day()['expected_cash'],
        ]);
    }

    /**
     * Every screen must give the SAME answer, and it must be the RIGHT one.
     *
     * Both halves matter. Agreement alone is satisfied by four screens reading
     * one broken query; correctness alone would let a right total sit beside a
     * wrong one and call the day green.
     *
     * @param  array<string, mixed>  $answers
     */
    private function agree(array &$wrong, string $question, float $truth, array $answers): void
    {
        foreach ($answers as $screen => $said) {
            if (round((float) $said, 2) !== round($truth, 2)) {
                $wrong[] = "{$question}: {$screen} says ".round((float) $said, 2)
                    .', the day was '.round($truth, 2);
            }
        }
    }

    // ── The steps ───────────────────────────────────────────────────

    private function openTheShop(string $type): void
    {
        City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);

        $this->shop = Tenant::factory()->create([
            'business_type' => $type,
            'features' => BusinessTypes::defaultFeatures($type),
            'setup_completed' => true,
            // UTC, because the day is closed off and read back within one test
            // and a shop clock five hours ahead puts the close on tomorrow.
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function cardTheItem(string $itemType, float $price, float $cost): Product
    {
        $id = $this->send('/api/v1/products', [
            'name' => 'The Day Item',
            'type' => $itemType === 'service' ? 'service' : 'product',
            'item_type' => $itemType,
            'price' => $price,
            'cost' => $cost,
            'track_inventory' => true,
            'low_stock_threshold' => 10,
        ], 201)['id'];

        return Product::withoutTenancy()->findOrFail($id);
    }

    private function buyStock(Product $product, float $qty, float $unitCost): void
    {
        $supplier = $this->send('/api/v1/suppliers', ['name' => 'The Day Traders'], 201)['id'];
        $this->supplierId = $supplier;

        $po = $this->send('/api/v1/purchase-orders', [
            'supplier_id' => $supplier,
            'order_date' => now()->toDateString(),
            'status' => 'ordered',
            'items' => [['product_id' => $product->id, 'quantity' => $qty, 'unit_cost' => $unitCost]],
        ], 201);

        $this->send("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => $qty]],
        ], 200);
    }

    private function openTheTill(float $float): void
    {
        $session = $this->send('/api/v1/pos/session/open', ['opening_float' => $float], 201);
        $this->sessionId = $session['id'];
        $this->openingFloat = $float;
    }

    /** @return array<string, mixed> the sale */
    private function sell(Product $product, float $qty, float $price, string $tender): array
    {
        $sale = $this->send('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $product->id, 'quantity' => $qty]],
            'payment_method' => $tender,
            'amount_paid' => $qty * $price,
        ], 201);

        $this->rung += (float) $sale['total'];
        if ($tender === 'cash') {
            $this->intoTheDrawer += (float) $sale['total'];
        }

        return $sale;
    }

    private function sellOnKhata(Product $product, float $qty, float $price): void
    {
        $this->customerId = $this->send('/api/v1/customers', [
            'name' => 'Khata Sahib',
            'phone' => '+923001234567',
            'credit_limit' => 50000,
        ], 201)['id'];

        $sale = $this->send('/api/v1/sales', [
            'channel' => 'walk_in',
            'customer_name' => 'Khata Sahib',
            'customer_phone' => '+923001234567',
            'items' => [['product_id' => $product->id, 'quantity' => $qty]],
            'payment_method' => 'credit',
            'amount_paid' => $qty * $price,
        ], 201);

        // Nothing enters the drawer: the whole point of a khata sale.
        $this->rung += (float) $sale['total'];
    }

    private function refundOneLine(array $sale, float $price): void
    {
        $refund = $this->send("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'refund_method' => 'cash',
            'reason' => 'Torn bag',
        ], 201);

        $this->refunded += (float) $refund['refund_total'];
        $this->outOfTheDrawer += (float) $refund['refund_total'];
    }

    private function takeKhataPayment(float $amount): void
    {
        $this->send("/api/v1/customers/{$this->customerId}/payments", [
            'amount' => $amount,
            'method' => 'cash',
        ], 201);

        $this->intoTheDrawer += $amount;
    }

    private function paySupplier(float $amount): void
    {
        $this->send("/api/v1/suppliers/{$this->supplierId}/payments", [
            'amount' => $amount,
            'method' => 'cash',
            'paid_at' => now()->toDateString(),
        ], 201);

        $this->outOfTheDrawer += $amount;
    }

    private function payABill(float $amount): void
    {
        $category = $this->send('/api/v1/expense-categories', ['name' => 'Wages'], 201)['id'];

        $this->send('/api/v1/expenses', [
            'expense_category_id' => $category,
            'description' => 'Loader — daily wage',
            'amount' => $amount,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'cash',
        ], 201);

        $this->billsPaid += $amount;
        $this->outOfTheDrawer += $amount;
    }

    /** The cashier counts out. Counted exactly, so any variance is a defect. */
    private function countTheDrawer(): void
    {
        $this->send('/api/v1/pos/session/close', [
            'counted_cash' => round($this->openingFloat + $this->intoTheDrawer - $this->outOfTheDrawer, 2),
        ], 200);
    }

    private function closeTheDay(): void
    {
        $current = $this->read('/api/v1/pos/day');
        $this->dayId = $current['day']['id'];

        $this->send("/api/v1/pos/days/{$this->dayId}/close", ['notes' => 'Shutter down'], 200);
    }

    // ── Reading the screens ─────────────────────────────────────────

    /** @return array<string, mixed> */
    private function day(): array
    {
        return $this->read("/api/v1/pos/days/{$this->dayId}");
    }

    /** @return array<string, mixed> */
    private function cashbookToday(): array
    {
        $days = $this->read('/api/v1/cashbook?'.http_build_query([
            'from' => now()->toDateString(), 'to' => now()->toDateString(),
        ]))['days'];

        $today = collect($days)->firstWhere('date', now()->toDateString());
        $this->assertNotNull($today, 'Today is missing from the cashbook entirely.');

        return $today;
    }

    // ── Plumbing ────────────────────────────────────────────────────

    private function as(): static
    {
        $this->defaultHeaders = [];
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function send(string $url, array $payload, int $expect): array
    {
        $res = $this->as()->postJson($url, $payload);

        // A step that failed must say which step, with the server's own words.
        // "Undefined array key data" thirty lines later is how a day-long flow
        // wastes an afternoon.
        $this->assertSame(
            $expect,
            $res->status(),
            "POST {$url} answered {$res->status()}: ".$res->content(),
        );

        return $res->json('data') ?? [];
    }

    /** @return array<string, mixed> */
    private function read(string $url): array
    {
        $res = $this->as()->getJson($url);
        $this->assertSame(200, $res->status(), "GET {$url} answered {$res->status()}: ".$res->content());

        return $res->json('data') ?? [];
    }
}
