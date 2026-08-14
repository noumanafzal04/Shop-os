<?php

namespace App\Support;

use App\Enums\PaymentMethod;
use App\Models\Product;

/**
 * What a till may do with no server — and the ONE rule that decides it.
 *
 * > Offline may do only what a single till can decide correctly, ALONE.
 *
 * Wherever two tills could reach different answers about the same thing — a
 * khata balance, a loyalty point, one specific IMEI, a coupon that may be used
 * once, a dining table — that thing stays online. Every refusal below is that
 * sentence applied and nothing else. No refusal here is about caution.
 *
 * ── Why this is enforced on the SERVER as well as the till ──────────────
 *
 * The till already refuses these at the counter, which is where the cashier
 * needs to hear it. That refusal is a user interface, not a boundary: the
 * outbox is a JSON queue in a browser database on a tablet that may have left
 * the shop. A sync endpoint that trusted it would accept "cash" on a sale that
 * was actually put on a customer's khata, and the shop's books would be wrong
 * in the direction nobody audits.
 *
 * ── Why a refusal here is never a rejection ─────────────────────────────
 *
 * A sale that has happened is never lost. If an operation arrives that offline
 * was not allowed to make, the money still crossed the counter — so it is
 * recorded and FLAGGED, not thrown away. The only thing refused is the claim
 * that it was a legitimate offline sale. See `PosSyncController`.
 */
class OfflinePolicy
{
    /**
     * Tenders a single till can settle on its own.
     *
     * Cash and card are done at the counter and settle nowhere else — a card
     * here is a RECORDED tender, not a gateway capture, so there is nothing to
     * authorise. The rest all move a balance that another till could be moving
     * at the same moment.
     */
    public const TENDERS = [
        PaymentMethod::Cash->value,
        PaymentMethod::Card->value,
        PaymentMethod::BankTransfer->value,
        PaymentMethod::Other->value,
        PaymentMethod::Split->value,
    ];

    /**
     * Why each of the others is out — kept as words because the cashier is
     * told the reason at the counter, and "not allowed" is not a reason.
     */
    public const TENDER_REASONS = [
        PaymentMethod::Credit->value => 'A khata balance is shared. Two tills could each add to it without seeing the other.',
        PaymentMethod::Deposit->value => 'An advance is held against an order the server keeps.',
        PaymentMethod::TradeIn->value => 'A trade-in values goods coming back in, which needs the catalog the server holds.',
    ];

    /** Can this product be sold by a till on its own? */
    public static function sellable(Product $product): bool
    {
        // A medicine needs live batch quantities, FEFO order and the expiry
        // fence. Selling expired stock offline is a regulatory event.
        if ($product->item_type === ItemTypes::MEDICINE) {
            return false;
        }

        // One specific handset. Two tills would sell the same IMEI.
        return ! $product->tracks_serial;
    }

    /** Why not, in the words the cashier sees. Null when it is sellable. */
    public static function refusalFor(Product $product): ?string
    {
        if ($product->item_type === ItemTypes::MEDICINE) {
            return 'Medicines need the live batch and expiry list, which only the server has.';
        }

        if ($product->tracks_serial) {
            return 'This item is tracked by serial number, and two tills offline could sell the same one.';
        }

        return null;
    }

    public static function tenderAllowed(?string $method): bool
    {
        return $method !== null && in_array($method, self::TENDERS, true);
    }

    /**
     * Everything about an operation that offline was not allowed to do.
     *
     * Returns the reasons rather than a boolean: a sale refused for three
     * different things should say all three, because a shop fixing one and
     * hitting the next has been told the truth twice and helped once.
     */
    public static function violations(array $sale): array
    {
        $reasons = [];

        if (! self::tenderAllowed($sale['payment_method'] ?? null)) {
            $method = $sale['payment_method'] ?? 'none';
            $reasons[] = self::TENDER_REASONS[$method]
                ?? "'{$method}' cannot be settled by a till on its own.";
        }

        // A table is a shared object. Two tills would seat the same one, and a
        // tab is settled against a bill the server is holding open.
        if (($sale['order_type'] ?? null) === 'dine_in') {
            $reasons[] = 'A dining table is shared between tills, so a tab must be opened and settled online.';
        }

        // Points are a balance. Earning is safe because it only ever adds and
        // is applied when the sale lands; redeeming spends against a figure
        // another till may be spending at the same time.
        if ((float) ($sale['redeem_points'] ?? 0) > 0) {
            $reasons[] = 'Redeeming points spends a shared balance, so it needs the server.';
        }

        // One code, one use. Two tills offline would each honour it.
        if (! empty($sale['coupon_code'])) {
            $reasons[] = 'A coupon can have a usage limit, which only the server can count.';
        }

        return $reasons;
    }
}
