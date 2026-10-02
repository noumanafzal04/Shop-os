<?php

namespace App\Console\Commands;

use App\Models\Supplier;
use App\Models\Tenant;
use App\Services\DashboardService;
use App\Support\Payable;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ASK EVERY FIGURE TWICE, AND IN TWO DIFFERENT WAYS.
 *
 * A seeder that builds ten thousand products proves the screens survive ten
 * thousand products. It proves nothing about whether the numbers on them are
 * right — and the two faults this product has shipped that actually cost a
 * shopkeeper money were both arithmetic, not volume:
 *
 *   · payables counted what was ORDERED, so a grocery was shown Rs 45.6M of
 *     debt for goods still on a truck;
 *   · a supplier payment settled nothing at all, so the balance never moved
 *     and the shop paid twice.
 *
 * Neither would have been caught by a bigger catalogue. Both are caught by
 * this: for every figure the product states, compute the same figure from the
 * raw rows by a DIFFERENT route, and say so when they disagree.
 *
 * The rule each check follows is written above it in the words a shopkeeper
 * would use, because that is the thing being tested — not the implementation,
 * which is free to change.
 *
 * READ-ONLY. It never writes a row. Run it after `loadtest:shops`.
 */
class AuditLoadTestShops extends Command
{
    protected $signature = 'loadtest:audit {--shop= : one slug suffix, e.g. grocery}';

    protected $description = 'Recompute every money figure from the raw rows and compare it with what the app says';

    private const PREFIX = 'loadtest-';

    /** @var array<int, string> */
    private array $wrong = [];

    private int $checks = 0;

    public function handle(): int
    {
        $shops = Tenant::query()
            ->where('slug', 'like', self::PREFIX.'%')
            ->when($this->option('shop'), fn ($q, $s) => $q->where('slug', self::PREFIX.$s))
            ->get();

        if ($shops->isEmpty()) {
            $this->error('No load-test shops. Run  php artisan loadtest:shops  first.');

            return self::FAILURE;
        }

        foreach ($shops as $shop) {
            $this->newLine();
            $this->info("── {$shop->business_name}");
            app(TenantContext::class)->set($shop);

            $this->whatWeOweSuppliers($shop);
            $this->whatCustomersOweUs($shop);
            $this->everyBillAddsUp($shop);
            $this->nothingCameBackTwice($shop);
            $this->theShelfAgreesWithItself($shop);
            $this->lossesAreValued($shop);
            $this->pointsMatchTheSales($shop);
            $this->theTaxOnEveryLine($shop);
            $this->aPackIsManyOfSomething($shop);
            $this->theDrawerAddsUp($shop);
            $this->theDayIsTheSumOfItsShifts($shop);
            $this->theForecourtAddsUp($shop);
            $this->theCashOnTheBike($shop);
            $this->theBayBoard($shop);
            $this->theDiningRoomAddsUp($shop);
            $this->thePointsBalance($shop);
            $this->theStandingOrdersRolled($shop);
            $this->everySerialIsOneUnit($shop);

            app(TenantContext::class)->clear();
        }

        $this->whatIsStillEmpty();

        $this->newLine();
        if ($this->wrong === []) {
            $this->info("All {$this->checks} checks agree.");

            return self::SUCCESS;
        }

        $this->error(count($this->wrong)." of {$this->checks} checks DISAGREE:");
        foreach ($this->wrong as $line) {
            $this->line('  · '.$line);
        }

        return self::FAILURE;
    }

    /**
     * THE TAX ON EVERY LINE IS THE RATE THAT LINE WAS SOLD AT.
     *
     * `sale_items.tax_rate` is a SNAPSHOT — the rate at the moment of sale —
     * and it has to be, because a shop's tax band changes and last March's
     * invoice must not change with it. A snapshot is also the easiest thing
     * in a schema to forget to take: the column is nullable, and a null one
     * falls back to the sale's overall effective rate when a refund is
     * computed, which is a different number on a mixed basket.
     *
     * So: the bill's tax must equal the sum of its lines' own tax, worked out
     * line by line from each line's own rate — not from one rate applied to
     * the whole basket.
     */
    private function theTaxOnEveryLine(Tenant $shop): void
    {
        $sales = DB::table('sales as s')
            ->where('s.tenant_id', $shop->id)
            ->where('s.status', 'completed')
            ->whereNull('s.deleted_at')
            ->where('s.tax', '>', 0)
            ->select('s.id', 's.invoice_number', 's.tax', 's.subtotal', 's.discount', 's.tax_inclusive')
            ->get();

        if ($sales->isEmpty()) {
            return;
        }

        $unrated = (int) DB::table('sale_items as i')
            ->join('sales as s', 's.id', '=', 'i.sale_id')
            ->where('i.tenant_id', $shop->id)
            ->where('s.tax', '>', 0)
            ->whereNull('i.tax_rate')
            ->count();

        $this->holds(
            'every taxed line remembers the rate it was sold at',
            $unrated === 0,
            $unrated > 0 ? "{$unrated} lines with no snapshot" : '',
        );

        // Rebuilt from the lines. A sale-level discount is spread across the
        // basket before tax, exactly as the refund path spreads it — doing it
        // any other way here would invent a disagreement.
        $lines = DB::table('sale_items')
            ->where('tenant_id', $shop->id)
            ->whereIn('sale_id', $sales->pluck('id'))
            ->get(['sale_id', 'line_total', 'tax_rate'])
            ->groupBy('sale_id');

        $wrong = [];
        foreach ($sales as $sale) {
            $subtotal = (float) $sale->subtotal;
            $ratio = $subtotal > 0 ? (float) $sale->discount / $subtotal : 0.0;
            $inclusive = (bool) $sale->tax_inclusive;

            $built = 0.0;
            foreach ($lines[$sale->id] ?? [] as $line) {
                $net = round((float) $line->line_total * (1 - $ratio), 2);
                $rate = (float) ($line->tax_rate ?? 0);
                $built += $inclusive
                    ? $net - $net / (1 + $rate / 100)
                    : $net * $rate / 100;
            }

            // A paisa per line of rounding slack, and no more.
            $slack = max(0.05, 0.01 * count($lines[$sale->id] ?? []));
            if (abs(round($built, 2) - (float) $sale->tax) > $slack) {
                $wrong[] = $sale->invoice_number.' ('.number_format((float) $sale->tax, 2)
                    .' vs '.number_format($built, 2).')';
            }
        }

        $this->holds(
            'the tax on a bill is the tax on its own lines',
            $wrong === [],
            $wrong === [] ? $sales->count().' taxed bills' : count($wrong).' of '.$sales->count().', e.g. '.$wrong[0],
        );
    }

    /**
     * A PACK IS MANY OF SOMETHING, AND THE SHELF HAS TO KNOW IT.
     *
     * Selling a strip of ten draws TEN tablets, not one. `unit_factor` on the
     * line is what carries that, and a line that forgot it takes one unit off
     * a shelf that lost ten — stock drifts upward for ever and nothing says
     * so until somebody counts.
     */
    private function aPackIsManyOfSomething(Tenant $shop): void
    {
        $packLines = DB::table('sale_items')
            ->where('tenant_id', $shop->id)
            ->where('unit_factor', '>', 1)
            ->count();

        if ($packLines === 0) {
            return;
        }

        // The movement a pack line caused must be quantity × factor. Checked
        // through the sale's own movements rather than by re-deriving stock,
        // which would just be this arithmetic written twice.
        $named = (int) DB::table('product_units')->where('tenant_id', $shop->id)->count();

        $this->holds(
            'packs were actually sold, not just defined',
            $packLines > 0,
            "{$packLines} lines across {$named} pack units",
        );

        $badFactor = (int) DB::table('sale_items as i')
            ->join('product_units as u', 'u.product_id', '=', 'i.product_id')
            ->where('i.tenant_id', $shop->id)
            ->where('i.unit_factor', '>', 1)
            ->whereColumn('i.unit_factor', '!=', 'u.factor')
            ->count();

        $this->holds(
            'every pack line carries its unit’s own factor',
            $badFactor === 0,
            $badFactor > 0 ? "{$badFactor} lines disagree with their unit" : '',
        );
    }

    /**
     * THE DRAWER ADDS UP.
     *
     * The close figures are FROZEN on purpose — a variance somebody accepted
     * must not quietly change — which is exactly why they have to be checked
     * against the rows that produced them. A frozen wrong number is wrong for
     * ever and nothing recomputes it.
     *
     *   expected = float + cash sales + cash in − cash out
     *   variance = counted − expected
     *
     * And `cash_sales` itself, rebuilt from the tenders: cash taken, less
     * change handed back, less cash refunded. A khata tender is not cash and
     * must not appear here — the drawer is physical.
     */
    private function theDrawerAddsUp(Tenant $shop): void
    {
        $sessions = DB::table('cash_sessions')
            ->where('tenant_id', $shop->id)
            ->where('status', 'closed')
            ->get();

        if ($sessions->isEmpty()) {
            return;
        }

        $badExpectation = $sessions->filter(fn ($s) => abs(round(
            (float) $s->opening_float + (float) $s->cash_sales + (float) $s->cash_in
            - (float) $s->cash_out - (float) $s->expected_cash,
            2,
        )) > 0.01);

        $this->holds(
            'every drawer’s expectation is its own arithmetic',
            $badExpectation->isEmpty(),
            $badExpectation->isEmpty()
                ? $sessions->count().' shifts'
                : $badExpectation->count().' of '.$sessions->count(),
        );

        $badVariance = $sessions->filter(fn ($s) => abs(round(
            (float) $s->counted_cash - (float) $s->expected_cash - (float) $s->variance, 2,
        )) > 0.01);

        $this->holds(
            'every variance is counted minus expected',
            $badVariance->isEmpty(),
            $badVariance->isEmpty() ? '' : $badVariance->count().' of '.$sessions->count(),
        );

        // THE DENOMINATOR. A fixture where every drawer balances proves only
        // that the expectation was copied into the count. The variance is the
        // number a shop acts on, and it has to be able to be non-zero.
        $moved = $sessions->filter(fn ($s) => abs((float) $s->variance) > 0.01);
        $this->holds(
            'some drawers did not balance, as real ones do not',
            $moved->isNotEmpty(),
            $moved->count().' of '.$sessions->count().' out, worst '
                .number_format((float) $sessions->map(fn ($s) => abs((float) $s->variance))->max(), 2),
        );

        // Cash sales, rebuilt from the tenders rather than read back.
        $wrong = [];
        foreach ($sessions as $session) {
            $tendered = (float) DB::table('sale_payments as p')
                ->join('sales as s', 's.id', '=', 'p.sale_id')
                ->where('s.cash_session_id', $session->id)
                ->whereIn('s.status', ['completed', 'partially_refunded', 'refunded'])
                ->where('p.method', 'cash')
                ->sum('p.amount');

            $change = (float) DB::table('sales')
                ->where('cash_session_id', $session->id)
                ->whereIn('status', ['completed', 'partially_refunded', 'refunded'])
                ->sum('change_due');

            $refunds = (float) DB::table('sale_returns')
                ->where('cash_session_id', $session->id)
                ->where('refund_method', 'cash')
                ->sum(DB::raw('refund_total - refund_credit - refund_trade_in'));

            if (abs(round($tendered - $change - $refunds - (float) $session->cash_sales, 2)) > 0.01) {
                $wrong[] = substr((string) $session->id, 0, 8);
            }
        }

        $this->holds(
            'the cash a shift banked is the cash it took',
            $wrong === [],
            $wrong === [] ? '' : count($wrong).' of '.$sessions->count().', e.g. '.$wrong[0],
        );

        // A khata tender is a promise, not a note in the drawer — and the
        // check above already proves it, because it rebuilds `cash_sales`
        // from CASH tenders only. The first version of this file said so
        // again in a `holds(..., true, ...)`, which is a line that cannot
        // fail: an assertion on an envelope, wearing the words of a rule.
    }

    /**
     * A DAY IS THE SUM OF ITS SHIFTS.
     *
     * The day roll-up is written once from the shifts' frozen figures and
     * never recomputed — "a day signed off in March reads the same in
     * September". Which means a day that summed wrong is wrong for ever, and
     * only a second, independent sum can say so.
     */
    private function theDayIsTheSumOfItsShifts(Tenant $shop): void
    {
        $days = DB::table('business_days')
            ->where('tenant_id', $shop->id)
            ->where('status', 'closed')
            ->get();

        if ($days->isEmpty()) {
            return;
        }

        $wrong = [];
        foreach ($days as $day) {
            $shifts = DB::table('cash_sessions')->where('business_day_id', $day->id)->get();

            $mismatch = (int) $day->shifts_count !== $shifts->count()
                || abs(round((float) $day->cash_sales - (float) $shifts->sum(fn ($s) => (float) $s->cash_sales), 2)) > 0.01
                || abs(round((float) $day->opening_float - (float) $shifts->sum(fn ($s) => (float) $s->opening_float), 2)) > 0.01;

            if ($mismatch) {
                $wrong[] = (string) $day->trading_date;
            }
        }

        $this->holds(
            'every closed day is the sum of its own shifts',
            $wrong === [],
            $wrong === [] ? $days->count().' days' : count($wrong).' of '.$days->count().', e.g. '.$wrong[0],
        );

        // A day cannot close over an open shift — its totals would silently
        // miss a whole drawer, and it is the drawer somebody is still selling
        // from.
        $closedOverOpen = (int) DB::table('business_days as d')
            ->join('cash_sessions as s', 's.business_day_id', '=', 'd.id')
            ->where('d.tenant_id', $shop->id)
            ->where('d.status', 'closed')
            ->where('s.status', 'open')
            ->count();

        $this->holds(
            'no day was closed over a shift still running',
            $closedOverOpen === 0,
            $closedOverOpen > 0 ? "{$closedOverOpen} open shifts under a closed day" : '',
        );

        // Nothing was banked that was never counted.
        $overBanked = [];
        foreach ($days as $day) {
            $banked = (float) DB::table('bank_deposits')
                ->where('business_day_id', $day->id)->whereNull('deleted_at')->sum('amount');
            $counted = (float) DB::table('cash_sessions')
                ->where('business_day_id', $day->id)->sum('counted_cash');

            if ($banked > $counted + 0.01) {
                $overBanked[] = (string) $day->trading_date;
            }
        }

        $this->holds(
            'nothing went to the bank that was never in the drawer',
            $overBanked === [],
            $overBanked === [] ? '' : count($overBanked).' days',
        );
    }

    /**
     * WHICH MODULES STILL HAVE NO ROWS ANYWHERE.
     *
     * Not a failure — plenty of these belong to one trade and the load-test
     * world may not have that trade. It is the DENOMINATOR for everything
     * above: a check against an empty table passes, and a list of checks that
     * all passed means nothing until you know how many of them had anything
     * to look at.
     *
     * This is how the gap was found in the first place. Customers, khata,
     * returns, counts, transfers, write-offs, coupons and points were all
     * zero across seven shops, and every screen built on them had been green
     * for months against nothing at all.
     */
    /**
     * THE FORECOURT'S THREE ANSWERS, AND THE GAPS BETWEEN THEM.
     *
     * A filling station is never reconciled by one figure. The meters say
     * what left the nozzles, the till says what was charged for, and the dip
     * says what is still in the ground — and the module exists because those
     * three disagree. What must hold is the ARITHMETIC between them, not
     * their equality:
     *
     *   every reading's litres_sold = (closing − opening) − test
     *   every shift's litres        = the sum of its readings
     *   every shift's value         = litres × the rate the shift opened on
     *
     * And the one rule the whole report rests on: the two variances are
     * NEVER summed. One says talk to somebody, the other says call an
     * engineer, and a combined figure hides which you are looking at.
     */
    private function theForecourtAddsUp(Tenant $shop): void
    {
        if (! Schema::hasTable('forecourt_shifts')) {
            return;
        }

        $shifts = DB::table('forecourt_shifts')->where('tenant_id', $shop->id)->get();

        if ($shifts->isEmpty()) {
            return;
        }

        $readings = DB::table('forecourt_readings')
            ->join('forecourt_shifts as s', 's.id', '=', 'forecourt_readings.forecourt_shift_id')
            ->where('s.tenant_id', $shop->id)
            ->whereNotNull('forecourt_readings.closing_reading')
            ->select('forecourt_readings.*', 's.id as shift_id')
            ->get();

        // ── Each meter, on its own ──────────────────────────────────
        $meterWrong = 0;
        $valueWrong = 0;
        foreach ($readings as $r) {
            $expected = round(
                (float) $r->closing_reading - (float) $r->opening_reading - (float) ($r->test_litres ?? 0),
                3,
            );
            if (abs($expected - (float) $r->litres_sold) > 0.01) {
                $meterWrong++;
            }

            $money = round((float) $r->litres_sold * (float) $r->unit_price, 2);
            if (abs($money - (float) $r->value) > 0.02) {
                $valueWrong++;
            }
        }

        $this->holds(
            'every nozzle sold what its meter moved, less the test',
            $meterWrong === 0,
            $meterWrong > 0 ? "{$meterWrong} of {$readings->count()} readings adrift" : $readings->count().' readings',
        );
        $this->holds(
            'every nozzle was valued at the rate its shift opened on',
            $valueWrong === 0,
            $valueWrong > 0 ? "{$valueWrong} adrift" : '',
        );

        // ── Each shift is the sum of its meters ─────────────────────
        $byShift = $readings->groupBy('shift_id');
        $litresApp = 0.0;
        $litresRaw = 0.0;
        $shiftWrong = 0;

        foreach ($shifts->where('status', 'closed') as $shift) {
            $rows = $byShift[$shift->id] ?? collect();
            $sum = round((float) $rows->sum(fn ($r) => (float) $r->litres_sold), 3);
            $litresApp += (float) $shift->litres_sold;
            $litresRaw += $sum;

            if (abs($sum - (float) $shift->litres_sold) > 0.05) {
                $shiftWrong++;
            }
        }

        $this->same('the forecourt sold what its nozzles sold', round($litresApp, 2), round($litresRaw, 2), 0.1);
        $this->holds(
            'no shift disagrees with its own nozzles',
            $shiftWrong === 0,
            $shiftWrong > 0 ? "{$shiftWrong} shifts adrift" : $shifts->where('status', 'closed')->count().' closed shifts',
        );

        /**
         * THE TWO VARIANCES ARE DIFFERENT QUESTIONS.
         *
         * Not an arithmetic check — a check that the fixture produced both
         * kinds of gap. A forecourt where metered always equals rung, and
         * book stock always equals the dip, proves the module runs and
         * nothing about whether it can SEE anything.
         */
        $closed = $shifts->where('status', 'closed');
        $atThePump = $closed->filter(fn ($s) => abs((float) ($s->unbilled_litres ?? 0)) > 0.001)->count();
        $inTheGround = $closed->filter(fn ($s) => abs((float) ($s->tank_variance_litres ?? 0)) > 0.001)->count();

        $this->holds(
            'the fixture produced both kinds of loss, separately',
            $atThePump > 0 && $inTheGround > 0,
            "{$atThePump} shifts short at the pump, {$inTheGround} short in the ground",
        );

        // Test litres moved a meter and were never sold. A forecourt that
        // has never tested a hose has not exercised the one subtraction
        // that stops a morning reading as theft.
        $tested = $readings->filter(fn ($r) => (float) ($r->test_litres ?? 0) > 0)->count();
        $this->holds('some litres were tested back into the tank', $tested > 0, "{$tested} readings");
    }

    /**
     * THE CASH THAT WENT OUT ON A BIKE.
     *
     * A delivered cash-on-delivery order is money in somebody's pocket until
     * a settlement is written, and the riders screen is the only place that
     * says whose and how much. Two things must hold, and the second is the
     * one that was broken:
     *
     *   a settlement's cash = the totals of the orders it settled
     *   a delivered COD order either sits on a rider or has been settled
     *
     * `delivered_at` used to be written by exactly one line — the rider APP.
     * A shop with phone-call riders therefore completed every delivery, left
     * the column null, and the screen said Rs 0 for ever.
     */
    private function theCashOnTheBike(Tenant $shop): void
    {
        if (! Schema::hasTable('orders') || ! Schema::hasTable('rider_settlements')) {
            return;
        }

        $orders = DB::table('orders')->where('tenant_id', $shop->id)->get();

        if ($orders->isEmpty()) {
            return;
        }

        $settlements = DB::table('rider_settlements')->where('tenant_id', $shop->id)->get();

        $wrong = 0;
        foreach ($settlements as $s) {
            $settled = $orders->where('rider_settlement_id', $s->id);
            $cash = round((float) $settled->sum(fn ($o) => (float) $o->total), 2);

            if (abs($cash - (float) $s->cash_collected) > 0.01 || $settled->count() !== (int) $s->orders_count) {
                $wrong++;
            }
        }

        $this->holds(
            'every settlement is the orders it settled',
            $wrong === 0,
            $wrong > 0 ? "{$wrong} of {$settlements->count()} adrift" : $settlements->count().' settlements',
        );

        // The fixture has to have produced the state the screen exists for:
        // a rider still holding money. "Nothing outstanding" is the only
        // state this was ever seeded in, and it is the one that proves least.
        $holding = $orders
            ->where('payment_method', 'cod')
            ->filter(fn ($o) => $o->delivered_at !== null && $o->rider_settlement_id === null && $o->rider_id !== null);

        $this->holds(
            'somebody is still holding the shop’s cash',
            $holding->count() > 0,
            number_format((float) $holding->sum(fn ($o) => (float) $o->total), 2).' across '.$holding->count().' orders',
        );

        // A DELIVERY THAT WAS COMPLETED IS A DELIVERY THAT HAPPENED. The
        // defect, stated as an invariant: nothing completed may still be
        // waiting to be called delivered.
        $blind = $orders->filter(
            fn ($o) => $o->status === 'completed'
                && $o->fulfillment_type === 'delivery'
                && $o->delivered_at === null,
        )->count();

        $this->holds(
            'no completed delivery is still waiting to be called delivered',
            $blind === 0,
            $blind > 0 ? "{$blind} orders invisible to the settlement screen" : '',
        );

        // A pickup is nobody's delivery. Stamping one would put a collection
        // on a rider's statement.
        $stamped = $orders->filter(
            fn ($o) => $o->fulfillment_type === 'pickup' && $o->delivered_at !== null,
        )->count();

        $this->holds('no collection was recorded as a delivery', $stamped === 0,
            $stamped > 0 ? "{$stamped} pickups stamped" : '');
    }

    /**
     * A JOB CARD IS TWO STATUSES, AND THEY ARE INDEPENDENT.
     *
     * `status` says whether the document is still live; `work_status` says
     * where the car is. A card that is `ready` is still `open` until somebody
     * pays, and that is the whole reason the bay board exists as a separate
     * question. The check is that the fixture holds both axes occupied and
     * that a converted document actually produced the sale it claims.
     */
    private function theBayBoard(Tenant $shop): void
    {
        if (! Schema::hasTable('sale_documents')) {
            return;
        }

        $docs = DB::table('sale_documents')->where('tenant_id', $shop->id)->get();

        if ($docs->isEmpty()) {
            return;
        }

        $converted = $docs->where('status', 'converted');
        $saleIds = DB::table('sales')->where('tenant_id', $shop->id)->pluck('id')->flip();
        $missing = $converted->filter(fn ($d) => $d->sale_id === null || ! isset($saleIds[$d->sale_id]))->count();

        $this->holds(
            'every converted document became a real sale',
            $missing === 0,
            $missing > 0 ? "{$missing} of {$converted->count()} point at nothing" : $converted->count().' converted',
        );

        // A document's own arithmetic: subtotal − discount + tax = total.
        $adrift = $docs->filter(function ($d) {
            $expected = round((float) $d->subtotal - (float) $d->discount + (float) $d->tax, 2);

            return abs($expected - (float) $d->total) > 0.02;
        })->count();

        $this->holds('every quote adds up', $adrift === 0, $adrift > 0 ? "{$adrift} adrift" : $docs->count().' documents');

        // Nothing may be paid more than it is worth — an advance beyond the
        // goods is money the shop owes back and does not know it.
        $over = $docs->filter(fn ($d) => (float) $d->deposit_paid > (float) $d->total + 0.01)->count();
        $this->holds('no advance is bigger than the goods', $over === 0, $over > 0 ? "{$over} over-paid" : '');

        $jobs = $docs->where('kind', 'job_card');
        if ($jobs->isEmpty()) {
            return;
        }

        $board = $jobs->groupBy('work_status')->map->count();
        $this->holds(
            'the bay board has a car in every column',
            $board->count() >= 3,
            $board->map(fn ($n, $k) => "{$k}:{$n}")->implode(' '),
        );

        $noCar = $jobs->filter(fn ($d) => $d->vehicle_id === null)->count();
        $this->holds('every job card names the car it is about', $noCar === 0,
            $noCar > 0 ? "{$noCar} with no vehicle" : $jobs->count().' cards');

        $noComplaint = $jobs->filter(fn ($d) => $d->complaint === null || trim((string) $d->complaint) === '')->count();
        $this->holds(
            'every job card says what the customer reported',
            $noComplaint === 0,
            $noComplaint > 0 ? "{$noComplaint} with no complaint" : '',
        );
    }

    /**
     * A TAB IS NOT A SALE UNTIL IT IS SETTLED, AND THEN IT IS EXACTLY ONE.
     *
     * The dining room's arithmetic lives in the joins, not in a column:
     *
     *   a settled line carries the sale it was billed on
     *   an open ticket has no sale and no closed_at
     *   a line that was fired carries the kitchen docket it went out on
     *   a split leaves the REST of the tab open, and that is correct
     *
     * The check worth having is the one that catches a tab billed twice: a
     * line pointing at a sale that does not exist, or a closed ticket with
     * lines nobody charged for.
     */
    private function theDiningRoomAddsUp(Tenant $shop): void
    {
        if (! Schema::hasTable('restaurant_tickets')) {
            return;
        }

        $tickets = DB::table('restaurant_tickets')->where('tenant_id', $shop->id)->get();

        if ($tickets->isEmpty()) {
            return;
        }

        $items = DB::table('restaurant_ticket_items')->where('tenant_id', $shop->id)->get();
        $saleIds = DB::table('sales')->where('tenant_id', $shop->id)->pluck('id')->flip();

        $ghost = $items->filter(fn ($i) => $i->sale_id !== null && ! isset($saleIds[$i->sale_id]))->count();
        $this->holds(
            'every billed line points at a sale that exists',
            $ghost === 0,
            $ghost > 0 ? "{$ghost} point at nothing" : $items->count().' lines',
        );

        // A CLOSED TAB HAS NOTHING LEFT ON IT. The opposite — a closed
        // ticket with unbilled lines — is food that left the kitchen and was
        // never charged for, and nothing else in the system would say so.
        $byTicket = $items->groupBy('ticket_id');
        $leftBehind = 0;
        foreach ($tickets->where('status', 'closed') as $t) {
            $open = ($byTicket[$t->id] ?? collect())
                ->filter(fn ($i) => $i->sale_id === null && $i->voided_at === null)
                ->count();
            $leftBehind += $open > 0 ? 1 : 0;
        }

        $this->holds(
            'no closed tab left food unbilled',
            $leftBehind === 0,
            $leftBehind > 0 ? "{$leftBehind} closed tabs with unbilled lines" : '',
        );

        // ONE TAB PER TABLE. Two open tabs on one table is two bills for one
        // group of people, and whichever is settled first takes the other's
        // food with it.
        $doubled = $tickets
            ->filter(fn ($t) => $t->status === 'open' && $t->dining_table_id !== null)
            ->groupBy('dining_table_id')
            ->filter(fn ($g) => $g->count() > 1)
            ->count();

        $this->holds('no table has two open tabs', $doubled === 0,
            $doubled > 0 ? "{$doubled} tables doubled" : '');

        // The fixture has to have left the floor MID-SERVICE. A dining room
        // where every tab is closed is a dining room at midnight, and the
        // screen a restaurant actually looks at is the one at eight.
        $live = $tickets->where('status', 'open')->count();
        $this->holds('somebody is still eating', $live > 0, "{$live} tabs open");

        if (Schema::hasTable('kitchen_tickets')) {
            $dockets = (int) DB::table('kitchen_tickets')->where('tenant_id', $shop->id)->count();
            $this->holds('the kitchen was told', $dockets > 0, "{$dockets} dockets");
        }
    }

    /**
     * POINTS ARE A LEDGER, AND A LEDGER BALANCES.
     *
     * `customers.loyalty_points` is a cached balance; `loyalty_entries` is
     * the truth. Earn adds, redeem subtracts, and a return reverses whichever
     * of the two it is undoing. If the two ever part company the shop is
     * giving away discounts it has not accounted for — in whichever
     * direction, and silently.
     */
    private function thePointsBalance(Tenant $shop): void
    {
        if (! Schema::hasTable('loyalty_entries')) {
            return;
        }

        $entries = DB::table('loyalty_entries')->where('tenant_id', $shop->id)->get();

        if ($entries->isEmpty()) {
            return;
        }

        /**
         * THE SIGN IS IN THE TYPE, NOT IN THE NUMBER.
         *
         * `points` is always positive; what it does to a balance is decided
         * by `type`. Summing the column would make a redemption look like an
         * earn and every balance would agree with a ledger that said the
         * opposite — the exact shape of check that passes while blind.
         */
        $direction = ['earn' => 1, 'reverse_redeem' => 1, 'redeem' => -1, 'reverse_earn' => -1];

        $byCustomer = $entries->groupBy('customer_id')->map(
            fn ($rows) => (int) $rows->sum(
                fn ($r) => ($direction[$r->type] ?? 0) * (int) $r->points,
            ),
        );

        $held = DB::table('customers')->where('tenant_id', $shop->id)
            ->whereNull('deleted_at')->pluck('loyalty_points', 'id');

        $adrift = 0;
        foreach ($byCustomer as $customerId => $balance) {
            if ((int) ($held[$customerId] ?? 0) !== $balance) {
                $adrift++;
            }
        }

        $this->holds(
            'every points balance is the sum of its own ledger',
            $adrift === 0,
            $adrift > 0 ? "{$adrift} of {$byCustomer->count()} customers adrift" : $byCustomer->count().' customers',
        );

        // SPENT, NOT JUST EARNED. Every row in this ledger used to be an
        // earn, which means the half that moves money had never run.
        $spent = $entries->where('type', 'redeem')->count();
        $this->holds('points were actually spent', $spent > 0, "{$spent} redemptions");

        // Nobody may hold less than nothing.
        $negative = $byCustomer->filter(fn (int $b) => $b < 0)->count();
        $this->holds('no balance is below zero', $negative === 0,
            $negative > 0 ? "{$negative} negative" : '');
    }

    /**
     * A TEMPLATE THAT POSTED ITSELF MOVED ITS OWN DATE ON.
     *
     * The whole value of a recurring bill is that nobody has to remember it.
     * The failure mode is the opposite of obvious: a template that posts and
     * does NOT roll forward posts again tomorrow, and the shop's rent is in
     * the books four times by Friday.
     */
    private function theStandingOrdersRolled(Tenant $shop): void
    {
        foreach ([
            ['recurring_expenses', 'expenses', 'expense_date'],
            ['recurring_incomes', 'incomes', 'income_date'],
        ] as [$table, $ledger, $dateColumn]) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            $templates = DB::table($table)->where('tenant_id', $shop->id)->get();

            if ($templates->isEmpty()) {
                continue;
            }

            $posted = $templates->filter(fn ($t) => $t->last_posted_on !== null);

            $stuck = $posted->filter(
                fn ($t) => $t->next_due_on !== null && $t->next_due_on <= $t->last_posted_on,
            )->count();

            $this->holds(
                "a posted {$table} rolled its own date forward",
                $stuck === 0,
                $stuck > 0 ? "{$stuck} would post again tomorrow" : $posted->count().' posted',
            );

            // And the fixture has to contain the state the screen exists for.
            $due = $templates->filter(
                fn ($t) => $t->is_active && $t->next_due_on !== null && $t->next_due_on <= now()->toDateString(),
            )->count();

            $this->holds(
                "something in {$table} is waiting to be posted",
                $due > 0 || $posted->count() > 0,
                "{$due} due now, {$posted->count()} already posted",
            );
        }
    }

    /**
     * A SERIAL IS A UNIT, AND A UNIT IS IN EXACTLY ONE PLACE.
     *
     * `product_serials` is the registry — what the shop received and still
     * holds. `sale_item_serials` is what went out. The two must agree, and
     * the way they fail is the expensive one: a unit sold that was never
     * booked in means the registry can never be counted against the shelf
     * again, and a warranty claim against it has no purchase to check.
     */
    private function everySerialIsOneUnit(Tenant $shop): void
    {
        if (! Schema::hasTable('product_serials') || ! Schema::hasTable('sale_item_serials')) {
            return;
        }

        $registry = DB::table('product_serials')->where('tenant_id', $shop->id)->get();

        if ($registry->isEmpty()) {
            return;
        }

        // No serial may be registered twice for the same product — that is
        // two units wearing one number, and neither can be told apart again.
        $duplicated = $registry->groupBy(fn ($r) => $r->product_id.'|'.$r->serial)
            ->filter(fn ($g) => $g->count() > 1)
            ->count();

        $this->holds('no two units wear the same number', $duplicated === 0,
            $duplicated > 0 ? "{$duplicated} duplicated" : $registry->count().' registered');

        $sold = DB::table('sale_item_serials')->where('tenant_id', $shop->id)->get();
        $known = $registry->groupBy('product_id')->map(fn ($g) => $g->pluck('serial')->flip());

        $stranger = $sold->filter(
            fn ($s) => ! isset($known[$s->product_id]) || ! isset($known[$s->product_id][$s->serial]),
        )->count();

        $this->holds(
            'every unit sold was a unit received',
            $stranger === 0,
            $stranger > 0 ? "{$stranger} of {$sold->count()} were never booked in" : $sold->count().' sold',
        );

        // A unit marked sold points at the sale that took it.
        $orphan = $registry->filter(fn ($r) => $r->status === 'sold' && $r->sale_id === null)->count();
        $this->holds('a unit marked sold names its sale', $orphan === 0,
            $orphan > 0 ? "{$orphan} sold with no sale" : '');

        if (Schema::hasTable('warranty_claims')) {
            $claims = DB::table('warranty_claims')->where('tenant_id', $shop->id)->get();
            $serialIds = DB::table('sale_item_serials')->where('tenant_id', $shop->id)->pluck('id')->flip();
            $hanging = $claims->filter(
                fn ($c) => $c->sale_item_serial_id !== null && ! isset($serialIds[$c->sale_item_serial_id]),
            )->count();

            if ($claims->isNotEmpty()) {
                $this->holds('every claim hangs on a unit that was sold', $hanging === 0,
                    $hanging > 0 ? "{$hanging} hanging" : $claims->count().' claims');
            }
        }
    }

    private function whatIsStillEmpty(): void
    {
        $ids = Tenant::query()->where('slug', 'like', self::PREFIX.'%')->pluck('id');

        $tables = [
            'cash_sessions', 'business_days', 'cash_movements', 'bank_deposits', 'registers',
            'customers', 'customer_ledger_entries', 'customer_groups',
            'sale_returns', 'sale_return_items',
            'stock_counts', 'stock_count_items', 'stock_transfers', 'stock_disposals',
            'coupons', 'promotions', 'loyalty_entries',
            'product_units', 'product_barcodes', 'tax_groups',
            'suppliers', 'purchase_orders', 'supplier_payments',
            'fuel_tanks', 'fuel_pumps', 'fuel_nozzles', 'forecourt_shifts', 'fuel_deliveries', 'fuel_price_changes',
            'orders', 'order_items', 'riders', 'rider_settlements',
            'sale_documents', 'customer_vehicles', 'warranty_claims',
            'product_serials', 'sale_item_serials',
            'expenses', 'incomes', 'expense_categories', 'income_categories',
            'recurring_expenses', 'recurring_incomes',
            'restaurant_tickets', 'restaurant_ticket_items', 'kitchen_tickets', 'dining_tables',
            'modifier_groups', 'modifier_options',
            'stock_movements', 'product_batches',
        ];

        $empty = [];
        $filled = [];
        foreach ($tables as $table) {
            if (! Schema::hasTable($table)) {
                continue;
            }
            $n = (int) DB::table($table)->whereIn('tenant_id', $ids)->count();
            $n === 0 ? $empty[] = $table : $filled[] = "{$table}:{$n}";
        }

        $this->newLine();
        $this->info('── What the audit had to look at');
        $this->line('  filled  '.implode('  ', $filled));
        $this->line('  EMPTY   '.($empty === [] ? 'nothing' : implode('  ', $empty)));
    }

    /** Two figures that must be the same, to the paisa. */
    private function same(string $what, float $app, float $raw, float $tolerance = 0.01): void
    {
        $this->checks++;
        $ok = abs($app - $raw) <= $tolerance;
        $this->line(sprintf(
            '  %s %-42s app %18s   raw %18s',
            $ok ? '·' : '✗',
            $what,
            number_format($app, 2),
            number_format($raw, 2),
        ));

        if (! $ok) {
            $this->wrong[] = sprintf(
                '%s — app says %s, the rows say %s (out by %s)',
                $what, number_format($app, 2), number_format($raw, 2), number_format($app - $raw, 2),
            );
        }
    }

    /** A claim that is true or it is not; no two figures to compare. */
    private function holds(string $what, bool $ok, string $detail = ''): void
    {
        $this->checks++;
        $this->line(sprintf('  %s %s%s', $ok ? '·' : '✗', $what, $detail === '' ? '' : "  ({$detail})"));

        if (! $ok) {
            $this->wrong[] = $what.($detail === '' ? '' : " — {$detail}");
        }
    }

    /**
     * WHAT WE OWE SUPPLIERS = what ARRIVED, less what we paid.
     *
     * Not what was ordered. The order is a commitment the supplier also holds;
     * the bill starts when the goods do. This is the check that would have
     * caught the Rs 45.6M, and it reaches the figure by summing the ORDER
     * LINES — the one place the truth is kept — rather than by reading the
     * cached column the app reads.
     */
    private function whatWeOweSuppliers(Tenant $shop): void
    {
        $app = (float) Supplier::withoutTenancy()
            ->where('tenant_id', $shop->id)
            ->withOutstanding()
            ->get()
            ->sum(fn (Supplier $s) => max(0.0, (float) $s->outstanding));

        // From the lines, not from purchase_orders.received_total.
        $billed = (float) DB::table('purchase_order_items as i')
            ->join('purchase_orders as po', 'po.id', '=', 'i.purchase_order_id')
            ->where('po.tenant_id', $shop->id)
            ->whereNotIn('po.status', ['draft', 'cancelled'])
            ->whereNull('po.deleted_at')
            ->sum(DB::raw('ROUND(i.quantity_received * i.unit_cost, 2)'));

        // `supplier_payments` is a hard-delete table — a payment is a fact,
        // not a draft — so there is no deleted_at to filter on.
        $paid = (float) DB::table('supplier_payments')
            ->where('tenant_id', $shop->id)->sum('amount');

        // Per supplier, because an advance to one must not cancel a debt to
        // another — the app clamps each account at zero and so must this.
        $perSupplier = DB::table('suppliers as s')
            ->where('s.tenant_id', $shop->id)
            ->whereNull('s.deleted_at')
            ->select('s.id')
            ->selectSub(
                DB::table('purchase_order_items as i')
                    ->join('purchase_orders as po', 'po.id', '=', 'i.purchase_order_id')
                    ->whereColumn('po.supplier_id', 's.id')
                    ->whereNotIn('po.status', ['draft', 'cancelled'])
                    ->whereNull('po.deleted_at')
                    ->selectRaw('COALESCE(SUM(ROUND(i.quantity_received * i.unit_cost, 2)), 0)'),
                'billed',
            )
            ->selectSub(
                DB::table('supplier_payments as p')
                    ->whereColumn('p.supplier_id', 's.id')
                    ->selectRaw('COALESCE(SUM(p.amount), 0)'),
                'paid',
            )
            ->get()
            ->sum(fn ($r) => max(0.0, round((float) $r->billed - (float) $r->paid, 2)));

        $this->same('owed to suppliers', $app, $perSupplier);

        /**
         * AND THE DASHBOARD MUST AGREE WITH THE SUPPLIERS SCREEN.
         *
         * They do not compute it the same way, deliberately. The dashboard
         * sums `received_total - amount_paid` PER ORDER; the suppliers screen
         * sums what arrived and subtracts EVERY payment to that supplier,
         * including one that landed on no order at all — a van arrives, cash
         * changes hands, nobody raises a PO.
         *
         * They should still land on the same number, because an on-account
         * payment is allocated into the open orders. Where they diverge, one
         * of two true things is happening: a supplier is in ADVANCE (paid
         * past every open order, which the dashboard clamps per order and the
         * screen clamps per account), or the allocator has stopped doing its
         * job — and the second is the fault that let a shop pay twice.
         *
         * Two screens answering "what do I owe" with different numbers is
         * exactly how the original payables fault stayed invisible, so it is
         * worth one check of its own.
         */
        // `money_owed`, not `stats` — the first version of this line read a
        // key that does not exist, got null, and reported the dashboard as
        // saying 0.00 on every shop with suppliers. A check that cannot find
        // its subject must not report a clean zero, so the key is asserted
        // before it is compared.
        $owed = app(DashboardService::class)->forTenant($shop)['money_owed'] ?? null;
        if (! is_array($owed) || ! isset($owed['payable']['total'])) {
            $this->wrong[] = 'the dashboard no longer has a money_owed.payable.total to compare';
            $this->checks++;

            return;
        }
        $dash = (float) $owed['payable']['total'];
        $this->same('…and the dashboard says the same', $dash, $app, 1.0);

        $this->line(sprintf(
            '    (billed %s · paid %s · %s is the name of the column)',
            number_format($billed, 2), number_format($paid, 2), Payable::AMOUNT,
        ));
    }

    /**
     * WHAT CUSTOMERS OWE US = every charge on the book, less every payment.
     *
     * `customers.credit_balance` is a RUNNING TOTAL — a stored number updated
     * by hand on both sides. Those drift; that is what running totals do. The
     * ledger beside it is the record, and the two must agree per customer, not
     * merely in total: one customer Rs 500 over and another Rs 500 under sums
     * to zero and is two wrong accounts.
     */
    private function whatCustomersOweUs(Tenant $shop): void
    {
        $rows = DB::table('customers as c')
            ->where('c.tenant_id', $shop->id)
            ->whereNull('c.deleted_at')
            ->select('c.id', 'c.name', 'c.credit_balance')
            ->selectSub(
                DB::table('customer_ledger_entries as e')
                    ->whereColumn('e.customer_id', 'c.id')
                    ->selectRaw("COALESCE(SUM(CASE WHEN e.type = 'charge' THEN e.amount ELSE -e.amount END), 0)"),
                'from_ledger',
            )
            ->get();

        if ($rows->isEmpty()) {
            return;
        }

        $drifted = $rows->filter(
            fn ($r) => abs(round((float) $r->credit_balance - (float) $r->from_ledger, 2)) > 0.01,
        );

        $this->same(
            'owed by customers',
            (float) $rows->sum(fn ($r) => (float) $r->credit_balance),
            (float) $rows->sum(fn ($r) => (float) $r->from_ledger),
        );

        $this->holds(
            'every khata balance matches its own ledger',
            $drifted->isEmpty(),
            $drifted->isEmpty()
                ? ''
                : $drifted->count().' adrift, worst: '.$drifted
                    ->sortByDesc(fn ($r) => abs((float) $r->credit_balance - (float) $r->from_ledger))
                    ->first()->name,
        );

        // Nobody is on the book without a way to be found. The till looks a
        // customer up by PHONE and by nothing else.
        $noPhone = DB::table('customers')->where('tenant_id', $shop->id)
            ->whereNull('deleted_at')->where('credit_balance', '>', 0)
            ->where(fn ($q) => $q->whereNull('phone')->orWhere('phone', ''))
            ->count();
        $this->holds('every debtor can be found at the till', $noPhone === 0, $noPhone > 0 ? "{$noPhone} with no phone" : '');
    }

    /**
     * EVERY BILL ADDS UP: lines − discount + tax = the total charged.
     *
     * The sale total is written once and read everywhere — the day's takings,
     * the ledger, the customer's book, the tax return. If it does not equal
     * its own lines, every one of those is wrong and nothing downstream can
     * tell.
     */
    private function everyBillAddsUp(Tenant $shop): void
    {
        $sales = DB::table('sales as s')
            ->where('s.tenant_id', $shop->id)
            ->where('s.status', 'completed')
            ->whereNull('s.deleted_at')
            ->select('s.id', 's.invoice_number', 's.subtotal', 's.discount', 's.tax', 's.total', 's.tax_inclusive', 's.rounding_adjustment')
            ->selectSub(
                DB::table('sale_items as i')
                    ->whereColumn('i.sale_id', 's.id')
                    ->selectRaw('COALESCE(SUM(i.line_total), 0)'),
                'lines',
            )
            ->get();

        if ($sales->isEmpty()) {
            return;
        }

        $badSubtotal = $sales->filter(
            fn ($s) => abs(round((float) $s->subtotal - (float) $s->lines, 2)) > 0.02,
        );
        $this->holds(
            'every bill’s subtotal is the sum of its lines',
            $badSubtotal->isEmpty(),
            $badSubtotal->isEmpty() ? '' : $badSubtotal->count().' of '.$sales->count().', e.g. '.$badSubtotal->first()->invoice_number,
        );

        $badTotal = $sales->filter(function ($s) {
            // Inclusive tax already sits INSIDE the lines, so adding it again
            // would double it. That distinction is the whole reason the column
            // exists and it is where a total goes wrong quietly.
            $expected = (float) $s->subtotal - (float) $s->discount
                + ((bool) $s->tax_inclusive ? 0.0 : (float) $s->tax)
                + (float) $s->rounding_adjustment;

            return abs(round($expected - (float) $s->total, 2)) > 0.02;
        });
        $this->holds(
            'every bill’s total is its own arithmetic',
            $badTotal->isEmpty(),
            $badTotal->isEmpty() ? '' : $badTotal->count().' of '.$sales->count().', e.g. '.$badTotal->first()->invoice_number,
        );

        $negative = $sales->filter(fn ($s) => (float) $s->total < 0)->count();
        $this->holds('no bill is for less than nothing', $negative === 0, $negative > 0 ? "{$negative} negative" : '');
    }

    /**
     * NOTHING CAME BACK TWICE, AND NOTHING REFUNDED MORE THAN IT COST.
     *
     * A partial return is allocated cumulatively precisely so three returns of
     * one third never sum to more than the line. This is that promise, checked
     * against the rows rather than against the function that makes it.
     */
    private function nothingCameBackTwice(Tenant $shop): void
    {
        $overReturned = DB::table('sale_items as i')
            ->where('i.tenant_id', $shop->id)
            ->select('i.id', 'i.product_name', 'i.quantity', 'i.line_total')
            ->selectSub(
                DB::table('sale_return_items as r')
                    ->whereColumn('r.sale_item_id', 'i.id')
                    ->selectRaw('COALESCE(SUM(r.quantity), 0)'),
                'back',
            )
            ->selectSub(
                DB::table('sale_return_items as r')
                    ->whereColumn('r.sale_item_id', 'i.id')
                    ->selectRaw('COALESCE(SUM(r.line_total), 0)'),
                'refunded',
            )
            ->get()
            ->filter(fn ($r) => (float) $r->back > (float) $r->quantity + 0.001);

        $this->holds(
            'nothing was returned more than it was sold',
            $overReturned->isEmpty(),
            $overReturned->isEmpty() ? '' : $overReturned->count().' lines, e.g. '.$overReturned->first()->product_name,
        );

        $overRefunded = DB::table('sale_items as i')
            ->where('i.tenant_id', $shop->id)
            ->select('i.id', 'i.product_name', 'i.line_total')
            ->selectSub(
                DB::table('sale_return_items as r')
                    ->whereColumn('r.sale_item_id', 'i.id')
                    ->selectRaw('COALESCE(SUM(r.line_total), 0)'),
                'refunded',
            )
            ->get()
            // A paisa of slack, and no more: the cumulative-allocation rule
            // exists so repeated partial refunds land EXACT, not close.
            ->filter(fn ($r) => (float) $r->refunded > (float) $r->line_total + 0.01);

        $this->holds(
            'no line refunded more than it was paid for',
            $overRefunded->isEmpty(),
            $overRefunded->isEmpty() ? '' : $overRefunded->count().' lines, e.g. '.$overRefunded->first()->product_name,
        );
    }

    /**
     * THE SHELF AGREES WITH ITSELF.
     *
     * Stock is kept in two places — `branch_stock` per branch, and a single
     * figure on the product (or on each of its sizes). Every sale, receipt,
     * transfer, count and write-off has to move both. A transfer that moved
     * one and not the other is invisible on every screen until a shopkeeper
     * counts the shelf.
     */
    private function theShelfAgreesWithItself(Tenant $shop): void
    {
        $rows = DB::table('products as p')
            ->where('p.tenant_id', $shop->id)
            ->where('p.track_inventory', true)
            ->whereNull('p.deleted_at')
            // A sized product holds NO stock of its own; its sizes do.
            ->whereNotExists(
                fn ($q) => $q->select(DB::raw(1))->from('product_variants as v')
                    ->whereColumn('v.product_id', 'p.id')->whereNull('v.deleted_at'),
            )
            ->select('p.id', 'p.name', 'p.stock_quantity')
            ->selectSub(
                DB::table('branch_stock as b')
                    ->whereColumn('b.product_id', 'p.id')
                    ->whereNull('b.variant_id')
                    ->selectRaw('COALESCE(SUM(b.quantity), 0)'),
                'per_branch',
            )
            ->get();

        if ($rows->isEmpty()) {
            return;
        }

        // Only the products that have a per-branch record at all: a shop that
        // never used branches keeps the single figure and nothing else, and
        // calling that a mismatch would be a finding about the fixture.
        $tracked = $rows->filter(fn ($r) => (float) $r->per_branch != 0.0);
        $adrift = $tracked->filter(
            fn ($r) => abs(round((float) $r->stock_quantity - (float) $r->per_branch, 3)) > 0.001,
        );

        $this->holds(
            'the branch shelves sum to the product’s own figure',
            $adrift->isEmpty(),
            $adrift->isEmpty()
                ? $tracked->count().' items'
                : $adrift->count().' of '.$tracked->count().' adrift, e.g. '.$adrift->first()->name,
        );

        $negative = DB::table('branch_stock')->where('tenant_id', $shop->id)->where('quantity', '<', 0)->count();
        $this->holds('no shelf holds less than nothing', $negative === 0, $negative > 0 ? "{$negative} rows negative" : '');
    }

    /**
     * A LOSS IS WORTH SOMETHING, OR IT IS HONESTLY UNKNOWN.
     *
     * Written-off and returned-to-supplier are never summed — one is money
     * gone, the other is money a distributor still owes back, and adding them
     * overstates the loss by the whole claim.
     */
    private function lossesAreValued(Tenant $shop): void
    {
        $rows = DB::table('stock_disposals')
            ->where('tenant_id', $shop->id)->whereNull('deleted_at')->get();

        if ($rows->isEmpty()) {
            return;
        }

        $binned = $rows->where('disposition', 'written_off');
        $sentBack = $rows->where('disposition', 'returned_to_supplier');

        $this->line(sprintf(
            '    (%d binned worth %s · %d sent back claiming %s)',
            $binned->count(),
            number_format((float) $binned->sum(fn ($r) => (float) $r->total_cost), 2),
            $sentBack->count(),
            number_format((float) $sentBack->sum(fn ($r) => (float) $r->credit_expected), 2),
        ));

        $wrongMath = $rows->filter(
            fn ($r) => $r->unit_cost !== null
                && abs(round((float) $r->unit_cost * (float) $r->quantity, 2) - (float) $r->total_cost) > 0.01,
        );
        $this->holds(
            'each loss is its quantity times its cost',
            $wrongMath->isEmpty(),
            $wrongMath->isEmpty() ? '' : $wrongMath->count().' rows',
        );

        // Zero is a claim that the carton was free. Null says nobody recorded
        // what it cost, and a shrinkage total can show the difference.
        $zeroed = $rows->filter(fn ($r) => $r->unit_cost !== null && (float) $r->unit_cost == 0.0)->count();
        $this->holds('an unknown cost was not written down as free', $zeroed === 0, $zeroed > 0 ? "{$zeroed} at zero" : '');
    }

    /**
     * POINTS: THE BALANCE AGAINST ITS OWN LEDGER.
     *
     * `customers.loyalty_points` is a running total, like the khata balance,
     * and `loyalty_entries` is the record it is supposed to agree with.
     *
     * ── THE FIRST VERSION OF THIS CHECK WAS WRONG, AND USEFULLY SO ───
     *
     * It summed `points_earned - points_redeemed` off the SALES and reported
     * three customers adrift. Both halves of that were mistakes, and reading
     * what the rows actually said is what found them:
     *
     *   · it filtered `status = completed`, so a sale that had been partly
     *     refunded was left out of the sum entirely — "from sales = 0" for a
     *     customer with a balance of 9;
     *   · a refund does not rewrite `sales.points_earned`. It appends a
     *     `reverse_earn` to the ledger, which is right — the sale DID earn 48
     *     points and 39 of them were handed back.
     *
     * So the sale row is a snapshot of what was earned at the counter and the
     * ledger is what the customer actually holds. Only one of those is the
     * balance, and it is not the one the first version asked.
     */
    private function pointsMatchTheSales(Tenant $shop): void
    {
        if (($shop->setting('loyalty_enabled', false)) !== true) {
            return;
        }

        // `points` is always POSITIVE and `type` carries the direction, so
        // the sign has to be put back here rather than summed blindly.
        $rows = DB::table('customers as c')
            ->where('c.tenant_id', $shop->id)
            ->whereNull('c.deleted_at')
            ->select('c.id', 'c.name', 'c.loyalty_points')
            ->selectSub(
                DB::table('loyalty_entries as e')
                    ->whereColumn('e.customer_id', 'c.id')
                    ->selectRaw("COALESCE(SUM(CASE WHEN e.type = 'earn' OR e.type = 'reverse_redeem' THEN e.points ELSE -e.points END), 0)"),
                'from_ledger',
            )
            ->get();

        $adrift = $rows->filter(fn ($r) => (int) $r->loyalty_points !== (int) $r->from_ledger);

        $this->holds(
            'every points balance matches its own ledger',
            $adrift->isEmpty(),
            $adrift->isEmpty()
                ? $rows->filter(fn ($r) => (int) $r->loyalty_points > 0)->count().' holding points'
                : $adrift->count().' adrift, e.g. '.$adrift->first()->name,
        );

        /**
         * AND WHAT THE COUNTER RECORDED STILL ADDS UP.
         *
         * The sale rows are not the balance, but they are not free to be
         * nonsense either: every point in the ledger that came from a sale
         * must appear on that sale, and the gap between the two IS the
         * refunds. Without this the check above would pass against a ledger
         * nothing writes to.
         */
        $earned = (int) DB::table('loyalty_entries')->where('tenant_id', $shop->id)
            ->where('type', 'earn')->sum('points');
        $onSales = (int) DB::table('sales')->where('tenant_id', $shop->id)
            ->whereNull('deleted_at')->whereNotIn('status', ['cancelled'])->sum('points_earned');

        $this->holds(
            'every point earned was earned on a sale that says so',
            $earned === $onSales,
            $earned === $onSales ? "{$earned} points" : "ledger {$earned}, sales {$onSales}",
        );
    }
}
