<?php

namespace App\Support;

use App\Enums\PurchaseStatus;
use App\Models\PurchaseOrder;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * WHAT THE SHOP OWES ITS SUPPLIERS — asked in one place.
 *
 * The question had three answers. The supplier card counted every order that
 * was not cancelled, so a DRAFT — a basket somebody is still filling — was
 * billed to the shop as a debt and put a red figure and a Pay button on the
 * row. The dashboard excluded drafts and said a smaller number. The purchases
 * report agreed with neither. Same debt, three screens, three totals.
 *
 * A draft is a shopping list. An order becomes a bill when it is PLACED, and
 * that is the line this class draws for everybody.
 */
final class Payable
{
    /**
     * The column that IS the bill.
     *
     * `total` is what was ordered; this is what arrived. Named once so the
     * supplier card, the dashboard, the purchases report and the payment
     * allocator cannot drift apart again — which is how this question came to
     * have three answers the first time.
     */
    public const AMOUNT = 'received_total';

    /**
     * Orders that are a real debt: placed, and not cancelled.
     *
     * @param  Builder<PurchaseOrder>  $query
     * @return Builder<PurchaseOrder>
     */
    public static function billable(Builder $query): Builder
    {
        return $query->whereNotIn('status', [
            PurchaseStatus::Cancelled->value,
            PurchaseStatus::Draft->value,
        ]);
    }

    /**
     * WHAT THE SHOP OWES, FOR THE WHOLE SHOP — one definition, three readers.
     *
     * Naming the COLUMN in one place was only half the job. The RULE — how to
     * net what arrived against what was paid — was still written out three
     * times, and the three had drifted into three different numbers on the
     * same shop:
     *
     *   suppliers screen   per supplier, every payment, clamped at zero
     *   dashboard          per ORDER, clamped at zero          +4,374,232
     *   purchases report   per supplier, signed                 −951,617
     *
     * The dashboard's was the damaging one. Clamping per ORDER throws away
     * every overpayment, and an overpaid order is not exotic: a shop pays the
     * bill and the van turns up two cartons short. Those rupees are credit
     * with that wholesaler and they must come off what the shop owes them.
     * On one load-test grocery the dashboard was 7% high because of it.
     *
     * ── WHY THE NETTING IS PER SUPPLIER AND NOT PER ORDER ────────────
     *
     * Money paid to a wholesaler is money paid, whichever docket it was
     * booked against. The shop and the wholesaler both keep ONE account in
     * their heads, and the Pay screen already works that way.
     *
     * ── AND WHY IT IS CLAMPED AT ALL ─────────────────────────────────
     *
     * Per supplier, never across them. Being Rs 40,000 in advance with the
     * flour merchant does not reduce what is owed to the tea merchant, and a
     * single signed total would quietly let it.
     *
     * PAID is read from `supplier_payments`, not from `purchase_orders.amount_paid`:
     * the difference is money that landed on no order at all — a van arrives,
     * cash changes hands, nobody raises a PO. Reading amount_paid made that
     * money invisible and the shop looked like it still owed it.
     *
     * @return array{total: float, accounts: int, advances: float}
     */
    public static function owedByShop(string $tenantId): array
    {
        $billed = self::billable(PurchaseOrder::withoutTenancy())
            ->where('tenant_id', $tenantId)
            ->selectRaw('supplier_id, SUM('.self::AMOUNT.') AS billed')
            ->groupBy('supplier_id')
            ->toBase();

        $balances = DB::table('suppliers as s')
            ->where('s.tenant_id', $tenantId)
            ->whereNull('s.deleted_at')
            ->leftJoinSub($billed, 'b', 'b.supplier_id', '=', 's.id')
            ->leftJoinSub(
                DB::table('supplier_payments')
                    ->where('tenant_id', $tenantId)
                    ->selectRaw('supplier_id, SUM(amount) AS paid')
                    ->groupBy('supplier_id'),
                'p',
                'p.supplier_id',
                '=',
                's.id',
            )
            ->selectRaw('COALESCE(b.billed, 0) - COALESCE(p.paid, 0) AS balance')
            ->pluck('balance');

        $owing = $balances->map(fn ($b) => round((float) $b, 2))->filter(fn (float $b) => $b > 0);

        return [
            'total' => round((float) $owing->sum(), 2),
            'accounts' => $owing->count(),
            // Money paid ahead of any delivery — owed back in goods, and a
            // real state of a small-shop account rather than a rounding error.
            'advances' => round((float) $balances
                ->map(fn ($b) => max(0.0, -round((float) $b, 2)))
                ->sum(), 2),
        ];
    }

    /**
     * The orders one payment can be applied to, oldest first.
     *
     * Oldest-first is not an arbitrary tiebreak: it is how a shop and a
     * wholesaler both keep the account in their heads, and it is the order in
     * which a supplier chases. `po_number` settles same-day orders so the
     * allocation is deterministic and a replay lands identically.
     *
     * @return Builder<PurchaseOrder>
     */
    public static function openOrdersFor(string $supplierId): Builder
    {
        return self::billable(PurchaseOrder::query())
            ->where('supplier_id', $supplierId)
            // Open against what ARRIVED. An order still on the truck owes
            // nothing, so a payment must not be allocated into it — that is
            // money handed over for stock the shop has not seen.
            ->whereColumn('amount_paid', '<', self::AMOUNT)
            ->orderBy('order_date')
            ->orderBy('po_number');
    }
}
