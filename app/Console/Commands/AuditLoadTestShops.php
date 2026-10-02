<?php

namespace App\Console\Commands;

use App\Models\Supplier;
use App\Models\Tenant;
use App\Services\DashboardService;
use App\Support\Payable;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

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

            app(TenantContext::class)->clear();
        }

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

        $paid = (float) DB::table('supplier_payments')
            ->where('tenant_id', $shop->id)->whereNull('deleted_at')->sum('amount');

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
                    ->whereNull('p.deleted_at')
                    ->selectRaw('COALESCE(SUM(p.amount), 0)'),
                'paid',
            )
            ->get()
            ->sum(fn ($r) => max(0.0, round((float) $r->billed - (float) $r->paid, 2)));

        $this->same('owed to suppliers', $app, $perSupplier);

        // And the dashboard must agree with the suppliers screen. Two screens
        // answering "what do I owe" differently is how the original fault
        // stayed invisible for so long.
        $dash = (float) (app(DashboardService::class)->summary($shop, 'monthly')['payable']['outstanding'] ?? 0);
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
     * POINTS ARE EARNED ON SALES AND SPENT ON SALES, AND NOWHERE ELSE.
     *
     * A customer's points balance is another running total. If it does not
     * equal earned minus redeemed across their sales, somebody is being given
     * or denied a discount they did not earn.
     */
    private function pointsMatchTheSales(Tenant $shop): void
    {
        if (($shop->setting('loyalty_enabled', false)) !== true) {
            return;
        }

        $rows = DB::table('customers as c')
            ->where('c.tenant_id', $shop->id)
            ->whereNull('c.deleted_at')
            ->select('c.id', 'c.name', 'c.loyalty_points')
            ->selectSub(
                DB::table('sales as s')
                    ->whereColumn('s.customer_id', 'c.id')
                    ->where('s.status', 'completed')
                    ->whereNull('s.deleted_at')
                    ->selectRaw('COALESCE(SUM(s.points_earned - s.points_redeemed), 0)'),
                'net_points',
            )
            ->get()
            ->filter(fn ($r) => (int) $r->loyalty_points !== (int) $r->net_points);

        $this->holds(
            'every points balance is what the sales earned less what they spent',
            $rows->isEmpty(),
            $rows->isEmpty() ? '' : $rows->count().' adrift, e.g. '.$rows->first()->name,
        );
    }
}
