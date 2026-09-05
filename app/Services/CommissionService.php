<?php

namespace App\Services;

use App\Exceptions\DomainException;
use App\Models\CommissionCharge;
use App\Models\CommissionInvoice;
use App\Models\Order;
use App\Models\Tenant;
use App\Models\User;
use App\Support\PlatformSettings;
use Illuminate\Support\Facades\DB;

/**
 * WHAT THE PLATFORM EARNS, AND WHEN.
 *
 * ── The line this file draws ─────────────────────────────────────────
 *
 * A shop pays a PLAN for the software. It pays COMMISSION for the customers
 * the marketplace brought it. Those are different debts with different
 * reasons, and mixing them is how a shop ends up unable to say what it is
 * being billed for.
 *
 * So commission is charged on ONLINE orders only. A walk-in at the till and a
 * phone order the shop wrote down itself are sales the platform had no part
 * in; billing those would be billing for the software twice.
 *
 * ── Charged at COMPLETION, never at placement ────────────────────────
 *
 * An order that is placed may be cancelled, refused, or never collected. Money
 * that has not changed hands is not revenue, and a platform that bills on
 * intent spends its week issuing credit notes.
 */
class CommissionService
{
    /**
     * The rate this shop pays, as a percentage.
     *
     * A shop's own rate wins; null — the normal case — follows the platform
     * default, so moving that default moves everybody who never bargained.
     */
    public function rateFor(Tenant $shop): float
    {
        if (! PlatformSettings::get('commission_enabled')) {
            return 0.0;
        }

        return (float) ($shop->commission_rate ?? PlatformSettings::get('commission_rate', 0));
    }

    /**
     * Record what this order earned the platform.
     *
     * Returns null — silently and on purpose — for every order that is not
     * chargeable. This is called from the completion path, and a throw there
     * would fail a delivery over a billing question.
     */
    public function chargeFor(Order $order): ?CommissionCharge
    {
        if ($order->channel !== 'online') {
            return null;
        }

        $shop = $order->tenant ?? Tenant::query()->find($order->tenant_id);
        if ($shop === null) {
            return null;
        }

        $rate = $this->rateFor($shop);
        if ($rate <= 0) {
            return null;
        }

        $base = $this->baseFor($order);
        if ($base <= 0) {
            return null;
        }

        // `firstOrCreate` on the order, because completion is retried — by a
        // queue, by a rider tapping twice, by a shop pressing the button after
        // a timeout. The unique index is the real guard; this is the one that
        // does not throw when it fires.
        return CommissionCharge::withoutTenancy()->firstOrCreate(
            ['order_id' => $order->id],
            [
                'tenant_id' => $order->tenant_id,
                'rate_percent' => $rate,
                'base_amount' => $base,
                'amount' => round($base * $rate / 100, 2),
            ],
        );
    }

    /**
     * What the percentage is taken of.
     *
     * `goods` leaves the delivery fee out, because that money is not the
     * shop's revenue — it is the rider's — and including it would make a shop
     * that delivers pay more for an identical basket.
     */
    private function baseFor(Order $order): float
    {
        $goods = round((float) $order->subtotal - (float) $order->discount, 2);

        return PlatformSettings::get('commission_base') === 'total'
            ? round($goods + (float) $order->delivery_fee, 2)
            : $goods;
    }

    /**
     * What a shop still owes: charged, not yet invoiced, not written off.
     *
     * @return array{orders: int, base: float, amount: float}
     */
    public function outstanding(Tenant $shop): array
    {
        $rows = CommissionCharge::withoutTenancy()
            ->where('tenant_id', $shop->id)
            ->outstanding()
            ->get(['base_amount', 'amount']);

        return [
            'orders' => $rows->count(),
            'base' => round((float) $rows->sum(fn ($c) => (float) $c->base_amount), 2),
            'amount' => round((float) $rows->sum(fn ($c) => (float) $c->amount), 2),
        ];
    }

    /**
     * Bundle a period's charges into one bill.
     *
     * Locked, and it takes only charges that are NOT already on an invoice —
     * two admins raising invoices for overlapping periods must not bill the
     * same order twice, and the window they typed is not what decides that.
     */
    public function raiseInvoice(Tenant $shop, string $from, string $to, User $admin): CommissionInvoice
    {
        return DB::transaction(function () use ($shop, $from, $to, $admin): CommissionInvoice {
            $charges = CommissionCharge::withoutTenancy()
                ->where('tenant_id', $shop->id)
                ->outstanding()
                ->whereDate('created_at', '>=', $from)
                ->whereDate('created_at', '<=', $to)
                ->lockForUpdate()
                ->get();

            if ($charges->isEmpty()) {
                throw DomainException::unprocessable(
                    'There is nothing to bill for that period.',
                    'COMMISSION_NOTHING_TO_BILL',
                );
            }

            $seq = CommissionInvoice::withoutTenancy()->where('tenant_id', $shop->id)->count() + 1;

            $invoice = CommissionInvoice::withoutTenancy()->create([
                'tenant_id' => $shop->id,
                'number' => 'COM-'.str_pad((string) $seq, 5, '0', STR_PAD_LEFT),
                'period_start' => $from,
                'period_end' => $to,
                'orders_count' => $charges->count(),
                'base_total' => round((float) $charges->sum(fn ($c) => (float) $c->base_amount), 2),
                'amount' => round((float) $charges->sum(fn ($c) => (float) $c->amount), 2),
                'status' => 'unpaid',
                'created_by' => $admin->id,
            ]);

            CommissionCharge::withoutTenancy()
                ->whereIn('id', $charges->pluck('id'))
                ->update(['invoice_id' => $invoice->id]);

            return $invoice;
        });
    }

    public function markPaid(CommissionInvoice $invoice, User $admin, ?string $note): CommissionInvoice
    {
        if ($invoice->status === 'void') {
            throw DomainException::conflict('That invoice was withdrawn.', 'COMMISSION_INVOICE_VOID');
        }
        if ($invoice->status === 'paid') {
            throw DomainException::conflict('That invoice is already paid.', 'COMMISSION_ALREADY_PAID');
        }

        $invoice->forceFill([
            'status' => 'paid',
            'paid_at' => now(),
            'paid_by' => $admin->id,
            'note' => $note ?? $invoice->note,
        ])->save();

        return $invoice->refresh();
    }

    /**
     * Withdraw an invoice and put its charges back.
     *
     * Void rather than delete: a shop that has seen a number is owed an
     * explanation of where it went, and the charges themselves are still real
     * — they simply are not on this bill any more.
     */
    public function voidInvoice(CommissionInvoice $invoice, User $admin, string $reason): CommissionInvoice
    {
        if ($invoice->status === 'paid') {
            throw DomainException::conflict(
                'A paid invoice cannot be withdrawn — refund it instead.',
                'COMMISSION_ALREADY_PAID',
            );
        }

        return DB::transaction(function () use ($invoice, $admin, $reason): CommissionInvoice {
            CommissionCharge::withoutTenancy()
                ->where('invoice_id', $invoice->id)
                ->update(['invoice_id' => null]);

            $invoice->forceFill([
                'status' => 'void',
                'note' => $reason,
                'paid_by' => $admin->id,
            ])->save();

            return $invoice->refresh();
        });
    }

    /** Write one charge off, with a reason somebody can read later. */
    public function waive(CommissionCharge $charge, User $admin, string $reason): CommissionCharge
    {
        if ($charge->invoice_id !== null) {
            throw DomainException::conflict(
                'That charge is already on an invoice — withdraw the invoice first.',
                'COMMISSION_ALREADY_INVOICED',
            );
        }

        $charge->forceFill([
            'waived_at' => now(),
            'waive_reason' => $reason,
            'waived_by' => $admin->id,
        ])->save();

        return $charge->refresh();
    }
}
