<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\User;

/**
 * The shop's discount ceiling, asked by every path that can give money away.
 *
 * ── Two different questions ─────────────────────────────────────────────
 *
 * `discounts.apply` answers **may you discount at all**, and it was checked on
 * the counter, the tab and the settlement alike. `max_discount_percent` and
 * `max_discount_amount` answer **how much**, and until this class existed they
 * were consulted in exactly one place: `CreateSaleAction`.
 *
 * So a cashier — who holds `discounts.apply` and deliberately does NOT hold
 * `discounts.override` — was capped at the till and uncapped on a dine-in tab.
 * The same person, the same shop setting, two answers. `SettleTicketAction`
 * rings its sale on the trusted path, which skips the counter's own check, so
 * nothing downstream caught it either: the ceiling an owner set in Settings was
 * simply absent from the floor.
 *
 * One implementation, for the same reason `ModifierResolver` is one: two copies
 * of a rule do not stay one rule.
 *
 * ── Why it is opt-in ────────────────────────────────────────────────────
 *
 * Both limits default to null, meaning no ceiling. The control did not exist
 * before it was added, so defaulting to a cap would have stopped shops selling
 * on the day it shipped.
 *
 * ── Why an aggregate ────────────────────────────────────────────────────
 *
 * The counter checks the WHOLE bill's discount against the whole subtotal, not
 * line by line, and a tab has to be read the same way or the two disagree
 * again. Ten lines at ten percent is the same giveaway as one line at a
 * hundred, and a per-line check would wave the first one through.
 */
class DiscountCeiling
{
    /**
     * Past the ceiling, a manager says yes with their PIN on the cashier's
     * till (B3 of the full re-test, 2026-10-18): the cashier's refusal said
     * "a manager has to approve it" and offered no way to — switching the till
     * to the manager failed too, the drawer being the cashier's. The approver
     * is returned so the sale can record who said yes; null when nobody had to.
     *
     * @param  float  $discount  every rupee coming off, line discounts included
     * @param  float  $subtotal  what the bill would be without any of it
     * @param  array{user_id?: string, pin?: string}|null  $approval
     */
    public static function assert(TenantContext $context, float $discount, float $subtotal, ?array $approval = null): ?User
    {
        if ($discount <= 0) {
            return null;
        }

        $settings = $context->get();
        $maxPct = $settings?->setting('max_discount_percent');
        $maxAmt = $settings?->setting('max_discount_amount');

        if (($maxPct === null || $maxPct === '') && ($maxAmt === null || $maxAmt === '')) {
            return null; // no ceiling configured
        }

        $user = auth()->user();
        // No authenticated actor = a backend/headless caller, which is trusted
        // by definition (the HTTP paths always have one).
        if ($user === null || $user->hasPermission(Permissions::DISCOUNTS_OVERRIDE)) {
            return null;
        }

        $pct = $subtotal > 0 ? round(($discount / $subtotal) * 100, 2) : 0.0;
        // In the shop's own money, to the paisa: a limit is a figure somebody is held to.
        $money = static fn (float $n): string => Currencies::format($n, $settings?->currency(), 2);

        $overPct = $maxPct !== null && $maxPct !== '' && $pct > (float) $maxPct + 0.001;
        $overAmt = $maxAmt !== null && $maxAmt !== '' && $discount > (float) $maxAmt + 0.001;
        if (($overPct || $overAmt) && $approval !== null) {
            return SupervisorApproval::verify($approval, Permissions::DISCOUNTS_OVERRIDE);
        }

        if ($overPct) {
            throw DomainException::forbidden(
                "This discount is {$pct}% — above the {$maxPct}% limit. A manager has to approve it.",
                'DISCOUNT_LIMIT_EXCEEDED',
            );
        }

        if ($overAmt) {
            throw DomainException::forbidden(
                'This discount is '.$money($discount)
                    .' — above the '.$money((float) $maxAmt)
                    .' limit. A manager has to approve it.',
                'DISCOUNT_LIMIT_EXCEEDED',
            );
        }

        return null;
    }
}
