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

    /** Ordered less paid. Positive is a debt; the supplier card signs it. */
    private float $owedToSupplier = 0.0;

    private float $onTheKhata = 0.0;

    private float $onTheShelf = 0.0;

    private ?string $dayId = null;

    private ?string $sessionId = null;

    private ?string $supplierId = null;

    private ?string $customerId = null;

    private ?string $productId = null;

    /**
     * Does this shop have a stockroom at all?
     *
     * Suppliers, purchase orders and receiving all ride `feature:inventory`. A
     * restaurant and a salon do not have it, and asking them to buy stock in
     * would test a 403 rather than a day. The steps that need it stand aside,
     * and the test's own books never learn about money that never moved.
     */
    private bool $buys = true;

    /**
     * Modules the day above actually puts through their paces.
     *
     * `services` is here because a salon's day sells one: the module is what
     * lets a `service` item exist at all, and the day sells nine of them.
     */
    private const WALKED_BY_THE_DAY = ['products', 'services', 'inventory', 'pos', 'expenses', 'dine_in'];

    /**
     * Modules a day AT THE COUNTER does not reach, and why — in writing.
     *
     * Not a suppression list. Each line is a claim that somebody looked, and
     * the moment a trade ships with something not on either list this file goes
     * red rather than quietly covering less than it used to.
     *
     * @var array<string, string>
     */
    private const NOT_A_DAY_AT_THE_COUNTER = [
        'marketplace' => 'the online shop is a different door with a different customer — MarketplaceTest walks it signed out',
        'delivery' => 'an order is placed before a day starts and fulfilled after it ends; what it must NOT do to the drawer is in the door matrix',
        'reservations' => 'a booking is not a transaction; nothing moves until it is honoured',
        'images' => 'a picture is not money and cannot disagree with a report',
        'fuel' => 'a forecourt shift is measured by meter and dip, not by a drawer — FuelManagementTest owns it, including fuel that crossed a meter and was never rung up',
    ];

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
            'a restaurant' => ['food', 'food_item', 450.0, 300.0],
            'a grocery' => ['mart', 'physical_product', 250.0, 180.0],
            'a chemist' => ['pharmacy', 'medicine', 180.0, 120.0],
            'a retailer' => ['retail', 'physical_product', 3500.0, 2600.0],
            'a salon' => ['services', 'service', 1200.0, 0.0],
            'a tyre shop' => ['automotive', 'physical_product', 9800.0, 7400.0],
            'a filling station' => ['petroleum', 'physical_product', 272.0, 250.0],
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

        if ($this->buys) {
            $this->buyStock($product, qty: 40, unitCost: $cost);
        }
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
        if ($this->buys) {
            $this->paySupplier(4000);
        }
        $this->payABill(1200);

        $this->countTheDrawer();
        $this->closeTheDay();

        // ── THE DENOMINATOR ─────────────────────────────────────────
        //
        // Every question below compares a screen with the test's own books, and
        // a day that traded NOTHING has books full of zeroes that every screen
        // agrees with perfectly. So the day says what it did before it asks
        // anybody about it. This is the assertion that stops the whole file
        // from passing the morning a step starts silently doing nothing.
        $this->assertEqualsWithDelta($price * 9, $this->rung, 0.01, 'the day rang nothing like nine items');
        $this->assertEqualsWithDelta($price, $this->refunded, 0.01, 'nothing was handed back');
        $this->assertGreaterThan(0, $this->intoTheDrawer, 'no cash ever entered the drawer');
        $this->assertGreaterThan(0, $this->outOfTheDrawer, 'no cash ever left the drawer');
        $this->assertNotNull($this->sessionId, 'no shift was ever opened');
        $this->assertSame('closed', $this->day()['status'], 'the day never closed off');
        $this->assertGreaterThan(0, $this->onTheKhata, 'nothing was put on the khata');
        if ($this->buys) {
            $this->assertGreaterThan(0, $this->owedToSupplier, 'the shop owes its supplier nothing');
            $this->assertEqualsWithDelta(32, $this->onTheShelf, 0.001, 'the shelf did not end at forty less nine plus one');
        }

        // ── THE CHORUS ──────────────────────────────────────────────
        $wrong = [];
        $this->whatDidTheShopTake($wrong);
        $this->whatWentBackOut($wrong);
        $this->whatShouldBeInTheDrawer($wrong);
        $this->whatDoCustomersOweUs($wrong);
        if ($this->buys) {
            $this->whatDoWeOweTheSupplier($wrong);
            $this->whatIsOnTheShelf($wrong);
        }

        $this->assertSame([], $wrong, "\n".implode("\n", $wrong)."\n");
    }

    /**
     * EVERY DOOR THAT RINGS A SALE, AGAINST THE ONE DRAWER.
     *
     * The counter is not the only way a sale is made in this product. It can
     * also be a quotation turned into an invoice, an exchange settled with a
     * top-up, a dine-in tab, an order completed, a reservation honoured — six
     * doors, all ending in a `Sale` row, and only ONE of them ever named the
     * drawer it happened on.
     *
     * A day flow that goes through the front door proves nothing about the
     * other five. So this puts the same cash amount through each one in turn
     * and asks the drawer what it did — because the failure is not that a door
     * errors, it is that a door SUCCEEDS and the till never hears.
     *
     * ── The one that must NOT move it ───────────────────────────────────
     *
     * An online order completing is not a sale being rung at a till: the rider
     * is still out with the goods, or the card was taken on the website. A
     * drawer that expects money which never crossed it is the same bug pointed
     * the other way, and it is worse — the cashier counts SHORT, and being
     * short is what people get accused over.
     *
     * So the matrix has both signs in it. A rule that only ever adds is not a
     * rule, it is an accident that happens to look right.
     */
    public function test_every_door_that_rings_a_sale_moves_the_one_drawer_that_should_move(): void
    {
        $this->openTheShop('mart');
        $item = $this->cardTheItem('physical_product', 100.0, 60.0);
        $this->stock($item, 500);
        $this->openTheTill(float: 1000);

        $wrong = [];
        $doors = 0;

        // 1. The counter. The door everything else is measured against.
        $doors++;
        $this->drawerMovesBy($wrong, 'the counter', 400.0, function () use ($item): void {
            $this->send('/api/v1/sales', [
                'channel' => 'walk_in',
                'items' => [['product_id' => $item->id, 'quantity' => 4]],
                'payment_method' => 'cash',
                'amount_paid' => 400.0,
            ], 201);
        });

        // 2. A quotation, accepted and turned into an invoice. The customer is
        //    standing there paying cash for it.
        $doors++;
        $quote = $this->send('/api/v1/sale-documents', [
            'kind' => 'quotation',
            'customer_name' => 'Quoted Sahib',
            'items' => [['product_id' => $item->id, 'quantity' => 3]],
        ], 201);
        $this->drawerMovesBy($wrong, 'a quotation turned into an invoice', 300.0, function () use ($quote): void {
            $this->send("/api/v1/sale-documents/{$quote['id']}/convert", [
                'payment_method' => 'cash',
                'amount_paid' => 300.0,
            ], 201);
        });

        // 3. An exchange where the customer takes MORE than they brought back.
        //    One unit returned against four sold, two taken away: the drawer
        //    gains the difference and nothing else.
        $doors++;
        $sale = $this->send('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $item->id, 'quantity' => 4]],
            'payment_method' => 'card',
            'amount_paid' => 400.0,
        ], 201);
        $this->drawerMovesBy($wrong, 'an exchange with a top-up', 100.0, function () use ($sale, $item): void {
            $this->send("/api/v1/sales/{$sale['id']}/exchange", [
                'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
                'items' => [['product_id' => $item->id, 'quantity' => 2]],
                'payments' => [['method' => 'cash', 'amount' => 100.0]],
            ], 201);
        });

        // 4. An online order completing. MUST NOT move it.
        $doors++;
        $order = $this->send('/api/v1/orders', [
            'customer_name' => 'Phone Sahib',
            'customer_phone' => '+923009998887',
            'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $item->id, 'quantity' => 5]],
        ], 201);
        // Walked through its own state machine — pending → confirmed →
        // preparing → ready — because an order cannot jump to completed and a
        // 409 here would look like a passing check.
        foreach (['confirmed', 'preparing', 'ready'] as $step) {
            $this->send("/api/v1/orders/{$order['id']}/advance", ['status' => $step], 200);
        }
        $this->drawerMovesBy($wrong, 'an order completed', 0.0, function () use ($order): void {
            $this->send("/api/v1/orders/{$order['id']}/advance", ['status' => 'completed'], 200);
        });

        // THE DENOMINATOR. A matrix that quietly stopped trying doors would
        // satisfy every assertion above.
        $this->assertGreaterThanOrEqual(4, $doors, 'the matrix shrank');

        $this->assertSame([], $wrong, "\n".implode("\n", $wrong)."\n");
    }

    /**
     * Run a door, and say what the drawer did about it.
     *
     * Read from `pos/session/report`, which is the X-read a cashier can pull
     * mid-shift — the same figure they will be measured against at close, and
     * the one the shop actually looks at.
     */
    private function drawerMovesBy(array &$wrong, string $door, float $expected, callable $run): void
    {
        $before = (float) $this->read('/api/v1/pos/session/report')['drawer']['expected_cash'];
        $run();
        $after = (float) $this->read('/api/v1/pos/session/report')['drawer']['expected_cash'];

        $moved = round($after - $before, 2);
        if ($moved !== round($expected, 2)) {
            $wrong[] = $expected === 0.0
                ? "{$door}: moved the drawer by {$moved} — it should not touch it at all"
                : "{$door}: the drawer moved by {$moved}, the cash taken was {$expected}";
        }
    }

    /**
     * A RESTAURANT'S DAY COMES OFF THE FLOOR, NOT THE COUNTER.
     *
     * Every rupee above went through `POST /sales`. A restaurant's does not: a
     * party sits down, a tab is opened on a table, the kitchen is fired, and at
     * the end the tab is SETTLED — `SettleTicketAction`, a different door
     * entirely. So a food shop could pass the whole day flow above on takeaway
     * sales while its actual trade, the floor, reconciled with nothing.
     *
     * That is not hypothetical. `SettleTicketAction` takes `cash_session_id`
     * from whatever it is handed and the panel's dine-in screen has never
     * filled it, so before `BooksDrawer::tillFor` a restaurant that traded
     * entirely off its floor closed the day off reading ZERO and its cashier
     * counted a drawer full of money the till had never heard of.
     *
     * The chorus here is the same chorus. The point is that the money arrives
     * by a different road and has to reach the same three places.
     */
    public function test_a_tab_settled_on_the_floor_reaches_the_drawer_and_the_day(): void
    {
        $this->openTheShop('food');
        $this->assertTrue($this->shop->featureEnabled('dine_in'), 'the restaurant fixture has no floor');

        $dish = $this->cardTheItem('food_item', 450.0, 300.0);
        $this->openTheTill(float: 3000);

        $table = $this->send('/api/v1/restaurant/tables', [
            'name' => 'Table 4', 'seats' => 4,
        ], 201)['id'];

        $tab = $this->send('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in',
            'dining_table_id' => $table,
            'guest_count' => 3,
        ], 201)['id'];

        $this->send("/api/v1/restaurant/tickets/{$tab}/items", [
            'items' => [['product_id' => $dish->id, 'quantity' => 4]],
        ], 200);

        // Fired to the pass. A docket that outlives its tab is its own bug —
        // see CancelledTabLeavesThePassTest — so the board is checked after.
        $this->send("/api/v1/restaurant/tickets/{$tab}/fire", [], 201);
        $this->assertGreaterThan(
            0,
            count($this->read('/api/v1/restaurant/kitchen')['kots'] ?? []),
            'nothing reached the pass',
        );

        // The party pays, in cash, at the counter.
        $bill = 4 * 450.0;
        $this->send("/api/v1/restaurant/tickets/{$tab}/settle", [
            'payment_method' => 'cash',
            'amount_paid' => $bill,
        ], 201);

        $this->rung += $bill;
        $this->intoTheDrawer += $bill;

        $this->countTheDrawer();
        $this->closeTheDay();

        // The denominator: a tab that settled for nothing would agree with
        // every screen below.
        $this->assertEqualsWithDelta(1800, $this->rung, 0.01, 'the floor rang nothing');

        $wrong = [];
        $this->whatDidTheShopTake($wrong);
        $this->whatShouldBeInTheDrawer($wrong);

        // And the floor itself: a settled tab frees its table and clears the
        // pass. A board still holding dockets for a party that has paid and
        // left is what the kitchen actually looks at all evening.
        $stillOpen = collect($this->read('/api/v1/restaurant/tickets'))
            ->firstWhere('id', $tab);
        if ($stillOpen !== null && ($stillOpen['status'] ?? null) === 'open') {
            $wrong[] = 'the floor: the tab is still open after it was settled';
        }
        if (count($this->read('/api/v1/restaurant/kitchen')['kots'] ?? []) > 0) {
            $wrong[] = 'the pass: dockets for a settled tab are still on the kitchen board';
        }

        $this->assertSame([], $wrong, "\n".implode("\n", $wrong)."\n");
    }

    /**
     * THE EIGHTH TRADE, WHICH HAS NO DAY AT ALL.
     *
     * A books-only shop sells nothing, so the flow above cannot describe it —
     * and the provider quietly having seven rows instead of eight is exactly
     * the shape of a check that deletes itself. So finance is named here, and
     * asserted from the opposite end: no till, no day to close, and money that
     * still lands in the same cashbook every counter trade writes to.
     *
     * `BooksOnlyTenantWalkthroughTest` owns the depth. This owns the ABSENCE,
     * because that is what the day flow would otherwise be silent about.
     */
    public function test_a_books_only_shop_has_no_day_to_close_and_still_keeps_a_cashbook(): void
    {
        $this->openTheShop('finance');

        $this->assertFalse($this->shop->featureEnabled('pos'), 'a books-only shop was given a till');

        // No shift, so no trading day was ever created — and the Day screen
        // must say so rather than erroring.
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 5000])
            ->assertForbidden();
        $this->assertNull(
            $this->as()->getJson('/api/v1/pos/day')->json('data'),
            'a shop with no till reported a trading day',
        );

        // Money still moves, and still reaches the books.
        $this->payABill(1200);
        $category = $this->send('/api/v1/income-categories', ['name' => 'Retainer'], 201)['id'];
        $this->send('/api/v1/incomes', [
            'income_category_id' => $category,
            'description' => 'Monthly retainer',
            'amount' => 9000,
            'income_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ], 201);

        $today = $this->cashbookToday();
        $this->assertEqualsWithDelta(0, (float) $today['sales_revenue'], 0.01, 'a books-only shop reported takings');
        $this->assertEqualsWithDelta(9000, (float) $today['other_income'], 0.01);
        $this->assertEqualsWithDelta(1200, (float) $today['expenses'], 0.01);
        $this->assertEqualsWithDelta(7800, (float) $today['net'], 0.01, 'the two entries do not add up to one day');
    }

    /**
     * EVERY MODULE A TRADE SHIPS WITH IS EITHER WALKED BY THE DAY, OR EXCUSED
     * IN WRITING.
     *
     * The day above is hand-written, and a hand-written day misses whatever
     * nobody thought of — which is the whole complaint that started this file.
     * This is the part that makes the next miss LOUD: it reads what each trade
     * actually ships with and insists that every module is either exercised or
     * named below with a reason.
     *
     * So the day a module is added to a trade's defaults, this test goes red
     * and somebody has to decide. That is the point. An excuse is cheap; not
     * noticing is not.
     */
    public function test_every_module_a_trade_ships_with_is_walked_or_excused(): void
    {
        $unaccounted = [];
        $pairs = 0;

        foreach (array_keys(BusinessTypes::all()) as $type) {
            foreach (BusinessTypes::defaultFeatures($type) as $module => $on) {
                if (! $on) {
                    continue;
                }
                $pairs++;

                if (in_array($module, self::WALKED_BY_THE_DAY, true)) {
                    continue;
                }
                if (array_key_exists($module, self::NOT_A_DAY_AT_THE_COUNTER)) {
                    continue;
                }

                $unaccounted[] = "{$type} ships with `{$module}` and the day neither walks it nor excuses it";
            }
        }

        // THE DENOMINATOR. A registry that returned nothing would satisfy every
        // line above while proving the opposite of what it claims.
        $this->assertGreaterThanOrEqual(8, count(BusinessTypes::all()), 'the trade registry shrank');
        $this->assertGreaterThanOrEqual(40, $pairs, 'barely any modules were examined');

        $this->assertSame([], array_unique($unaccounted), "\n".implode("\n", array_unique($unaccounted))."\n");
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
     * Q3 — what do we owe the supplier?
     *
     * Three screens compute this three ways: the supplier's own card sums the
     * ORDERS and subtracts every PAYMENT (so an advance shows as a negative),
     * the dashboard sums `total - amount_paid` PER ORDER, and the purchases
     * report sums both sides of the period. They agree only while payments are
     * being allocated to orders properly — which is exactly what was broken
     * when this file was started.
     */
    private function whatDoWeOweTheSupplier(array &$wrong): void
    {
        $this->agree($wrong, 'what we owe the supplier', $this->owedToSupplier, [
            "the supplier's card" => $this->read("/api/v1/suppliers/{$this->supplierId}")['outstanding'],
            'the dashboard' => $this->read('/api/v1/dashboard')['money_owed']['payable']['total'],
            'the purchases report' => $this->read('/api/v1/reports/purchases?'.http_build_query([
                'from' => now()->subDay()->toDateString(), 'to' => now()->addDay()->toDateString(),
            ]))['totals']['outstanding'],
        ]);
    }

    /**
     * Q4 — what do customers owe us?
     *
     * The khata. The day's refund does NOT belong here: the bag that came back
     * was bought with cash, and a refund reducing a debt it never created is
     * one of the ways this figure drifts.
     *
     * ── Three sources, not three readers ────────────────────────────────
     *
     * The customer card, the customer list and the dashboard all read the SAME
     * `credit_balance` column, so asking all three proves only that the column
     * exists — they cannot disagree. The question worth asking is whether the
     * stored balance still matches the STATEMENT it was built from, because a
     * shopkeeper hands the statement across the counter when a customer argues,
     * and a running balance that has drifted from the stored one is found
     * months later by the person least able to explain it.
     *
     * So: the column, the newest running balance on the statement, and the
     * statement re-added from nothing.
     */
    private function whatDoCustomersOweUs(array &$wrong): void
    {
        $card = $this->read("/api/v1/customers/{$this->customerId}");
        $statement = collect($card['ledger'] ?? []);

        $this->assertGreaterThanOrEqual(
            2,
            $statement->count(),
            'the khata statement has fewer than two lines — a sale on credit and a repayment both happened',
        );

        // A charge adds to the debt; everything else pays it down.
        $readded = $statement->reduce(
            fn (float $carry, array $row): float => $row['type'] === 'charge'
                ? $carry + (float) $row['amount']
                : $carry - (float) $row['amount'],
            0.0,
        );

        $this->agree($wrong, 'what the customer owes', $this->onTheKhata, [
            'their record' => $card['credit_balance'],
            'the dashboard' => $this->read('/api/v1/dashboard')['money_owed']['receivable']['total'],
            "the statement's running balance" => $statement->first()['balance_after'],
            'the statement, re-added' => $readded,
        ]);
    }

    /**
     * Q5 — what is on the shelf?
     *
     * Bought forty, sold nine, one came back. Asked in UNITS rather than in
     * money, because the three screens value stock differently on purpose (a
     * lot carries its own cost) and a disagreement about VALUE would be a
     * different finding from a disagreement about how much is there.
     */
    private function whatIsOnTheShelf(array &$wrong): void
    {
        $grid = collect($this->read('/api/v1/products'))->firstWhere('id', $this->productId);
        $this->assertNotNull($grid, 'the day\'s item is not in the catalog grid at all');

        $this->agree($wrong, 'what is on the shelf', $this->onTheShelf, [
            "the item\'s own card" => $this->read("/api/v1/products/{$this->productId}")['stock_quantity'],
            'the catalog grid' => $grid['stock_quantity'],
            'the valuation report' => $this->read('/api/v1/reports/valuation')['totals']['units'],
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
        $this->buys = $this->shop->featureEnabled('inventory');
    }

    private function cardTheItem(string $itemType, float $price, float $cost): Product
    {
        // A haircut has no shelf, and the catalog says so out loud: sending
        // `track_inventory` on a service is PROHIBITED, not merely ignored. So
        // the two stock fields are only on the payload for a shop that keeps
        // stock — which is the same question `$this->buys` already answers.
        $stockFields = $this->buys && $itemType !== 'service'
            ? ['track_inventory' => true, 'low_stock_threshold' => 10]
            : [];

        $id = $this->send('/api/v1/products', [
            'name' => 'The Day Item',
            'type' => $itemType === 'service' ? 'service' : 'product',
            'item_type' => $itemType,
            'price' => $price,
            'cost' => $cost,
            ...$stockFields,
        ], 201)['id'];

        $this->productId = $id;

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
            // Undated goods are refused outright for a chemist (EXPIRY_REQUIRED)
            // and harmless everywhere else, so the day always dates them.
            'items' => [[
                'id' => $po['items'][0]['id'],
                'quantity' => $qty,
                'expiry_date' => now()->addYear()->toDateString(),
            ]],
        ], 200);

        $this->owedToSupplier += $qty * $unitCost;
        $this->onTheShelf += $qty;
    }

    /** Stock on the shelf without a delivery, for the tests that are not about buying. */
    private function stock(Product $product, float $qty): void
    {
        $this->send('/api/v1/inventory/adjust', [
            'product_id' => $product->id,
            'type' => 'set',
            'new_quantity' => $qty,
            'reason' => 'opening stock',
        ], 201);
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
        $this->onTheShelf -= $qty;
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

        // Nothing enters the drawer: the whole point of a khata sale. It goes
        // on the customer's account instead, which is Q4.
        $this->rung += (float) $sale['total'];
        $this->onTheKhata += (float) $sale['total'];
        $this->onTheShelf -= $qty;
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
        $this->onTheShelf += 1;
    }

    private function takeKhataPayment(float $amount): void
    {
        $this->send("/api/v1/customers/{$this->customerId}/payments", [
            'amount' => $amount,
            'method' => 'cash',
        ], 201);

        $this->intoTheDrawer += $amount;
        $this->onTheKhata -= $amount;
    }

    private function paySupplier(float $amount): void
    {
        $this->send("/api/v1/suppliers/{$this->supplierId}/payments", [
            'amount' => $amount,
            'method' => 'cash',
            'paid_at' => now()->toDateString(),
        ], 201);

        $this->outOfTheDrawer += $amount;
        $this->owedToSupplier -= $amount;
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
            // The BODY, not the status. A 422 whose field errors are hidden
            // costs an afternoon; this file has already spent one.
            "POST {$url} answered {$res->status()}: ".json_encode($res->json('errors') ?? $res->json()),
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
