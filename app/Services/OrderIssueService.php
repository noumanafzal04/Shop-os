<?php

namespace App\Services;

use App\Exceptions\DomainException;
use App\Models\Coupon;
use App\Models\Order;
use App\Models\OrderIssue;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Support\Str;

/**
 * "ORDER MEIN MASLA" — a customer reports a problem, the platform answers it.
 *
 * Foodpanda's most-used screen, and the one a customer trusts the app by: the
 * thing that was missing is said ONCE, in the app, to somebody who can act —
 * not by phoning a shop that already has the money.
 */
class OrderIssueService
{
    /** How long after an order a problem may still be reported. */
    public const REPORT_WITHIN_HOURS = 72;

    /** An order still open this long after it was placed may be reported as late. */
    public const LATE_AFTER_MINUTES = 45;

    public function __construct(private readonly NotificationService $notifications) {}

    /** Whether a problem may be reported on this order now — and why not. */
    public function whyNot(Order $order): ?string
    {
        if ($order->relationLoaded('issue') ? $order->issue !== null : $order->issue()->exists()) {
            return 'A problem was already reported on this order.';
        }
        if ($order->status->isOpen()) {
            return $order->placed_at !== null && $order->placed_at->lte(now()->subMinutes(self::LATE_AFTER_MINUTES))
                ? null
                : 'You can report a problem once the order arrives, or if it is very late.';
        }
        $closedAt = $order->delivered_at ?? $order->updated_at;
        if ($closedAt === null || $closedAt->lt(now()->subHours(self::REPORT_WITHIN_HOURS))) {
            return 'Problems can be reported up to '.self::REPORT_WITHIN_HOURS.' hours after an order.';
        }

        return null;
    }

    public function report(User $customer, Order $order, string $kind, ?string $note): OrderIssue
    {
        if (($why = $this->whyNot($order)) !== null) {
            throw DomainException::unprocessable($why, 'ISSUE_NOT_OPEN');
        }

        $issue = OrderIssue::query()->create([
            'tenant_id' => $order->tenant_id,
            'order_id' => $order->id,
            'customer_id' => $customer->id,
            'kind' => $kind,
            'status' => 'open',
            'note' => $note !== null && trim($note) !== '' ? trim($note) : null,
        ]);

        $shop = Tenant::query()->find($order->tenant_id);
        if ($shop !== null) {
            $this->notifications->notifyWhoCanAct(
                $shop,
                Permissions::ORDERS_MANAGE,
                'order.issue',
                'A customer reported a problem',
                "{$order->order_number}: ".OrderIssue::KINDS[$kind].($issue->note !== null ? " — {$issue->note}" : '.'),
                ['order_id' => $order->id, 'issue_id' => $issue->id],
                "order-issue-{$issue->id}",
                $order->branch_id,
            );
        }

        return $issue;
    }

    /**
     * The platform's answer.
     *
     *   refund   money back — the amount is recorded and the shop told to pay it
     *   voucher  a one-use voucher at the same shop, for 30 days
     *   none     no money; the answer says why (the issue is rejected)
     */
    public function resolve(OrderIssue $issue, User $by, string $outcome, ?float $amount, string $answer): OrderIssue
    {
        if ($issue->status !== 'open') {
            throw DomainException::conflict('This problem has already been answered.', 'ISSUE_CLOSED');
        }

        $order = Order::withoutTenancy()->findOrFail($issue->order_id);
        if ($outcome !== 'none') {
            if ($amount === null || $amount <= 0) {
                throw DomainException::unprocessable('Say how much.', 'ISSUE_AMOUNT_REQUIRED');
            }
            if ($amount > (float) $order->total) {
                throw DomainException::unprocessable('More than the order cost ('.$order->total.').', 'ISSUE_AMOUNT_TOO_HIGH');
            }
        }

        $shop = Tenant::query()->findOrFail($order->tenant_id);
        $voucher = null;
        if ($outcome === 'voucher') {
            // A voucher is a coupon at THAT shop — and a shop without the
            // promotions module cannot take one at checkout.
            if (! $shop->featureEnabled('promotions')) {
                throw DomainException::unprocessable(
                    'This shop does not take vouchers — give a refund instead.',
                    'VOUCHER_UNAVAILABLE',
                );
            }
            $voucher = 'SORRY-'.Str::upper(Str::random(6));
            Coupon::withoutTenancy()->create([
                'tenant_id' => $shop->id,
                'code' => $voucher,
                'type' => 'fixed',
                'value' => round((float) $amount, 2),
                'usage_limit' => 1,
                'expires_at' => now()->addDays(30),
                'is_active' => true,
            ]);
        }

        $issue->forceFill([
            'status' => $outcome === 'none' ? 'rejected' : 'resolved',
            'outcome' => $outcome,
            'amount' => $outcome === 'none' ? null : round((float) $amount, 2),
            'voucher_code' => $voucher,
            'answer' => trim($answer),
            'resolved_by' => $by->id,
            'resolved_at' => now(),
        ])->save();

        $customer = User::query()->find($issue->customer_id);
        if ($customer !== null) {
            $this->notifications->notify(
                $customer,
                'order.issue_answered',
                'About your order '.$order->order_number,
                match ($outcome) {
                    'refund' => 'A refund of '.$shop->money((float) $amount).' is coming to you. '.$issue->answer,
                    'voucher' => 'A voucher '.$voucher.' worth '.$shop->money((float) $amount).' — use it at '.$shop->business_name.' within 30 days. '.$issue->answer,
                    default => $issue->answer,
                },
                ['order_id' => $order->id, 'issue_id' => $issue->id],
                "order-issue-answered-{$issue->id}",
            );
        }

        if ($outcome === 'refund') {
            $this->notifications->notifyWhoCanAct(
                $shop,
                Permissions::ORDERS_MANAGE,
                'order.issue_refund',
                'Refund a customer',
                "{$order->order_number}: refund ".$shop->money((float) $amount)." to {$order->customer_name}. {$issue->answer}",
                ['order_id' => $order->id, 'issue_id' => $issue->id],
                "order-issue-refund-{$issue->id}",
                $order->branch_id,
            );
        }

        return $issue;
    }
}
