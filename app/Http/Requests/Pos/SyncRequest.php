<?php

namespace App\Http\Requests\Pos;

use App\Http\Requests\Sale\StoreSaleRequest;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A batch of sales that were rung with no server.
 *
 * ── Why the sale's rules are BORROWED and not restated ──────────────────
 *
 * Every rule under `operations.*.sale.` is `StoreSaleRequest`'s, re-keyed. It
 * would be easy to write a smaller set here — an offline cart is simpler — and
 * that is exactly the trap. The two shapes would drift, and the drift would be
 * silent and one-directional: a field added to the online sale next year is a
 * field the offline path quietly starts dropping. A cashier's tip, a
 * prescription, a vehicle's odometer — gone, with nothing failing.
 *
 * Borrowing means a new rule lands on both paths or neither.
 *
 * ── Two rules are deliberately NOT borrowed ─────────────────────────────
 *
 * `idempotency_key` moves up to the operation, where it belongs: the op id is
 * minted when the cashier hits Complete, and a sale that carried its own would
 * let one operation claim a different one's identity.
 *
 * `cash_session_id` loses its `OwnOpenShift` rule. That rule asks "is this
 * shift open, and yours?" — a fair question online and the wrong one here. A
 * sale rung on Tuesday syncs on Friday, by which time Tuesday's drawer has
 * been counted and closed, and refusing it would throw away the record of money
 * that is already in the till. The shift is still where `is_training` comes
 * from, so it is kept; it is simply no longer required to be open.
 *
 * That last point has a sharp edge, which is why `operations.*.training`
 * exists. Once the shift need not be open OR the caller's, naming a practice
 * shift would be enough to make a real sale take no stock and earn no revenue
 * — silently, because none of the training warnings a cashier sees online ever
 * appeared. So the till states what IT believed too, and practice needs both.
 * The till's word cannot create training; it can only withhold it.
 */
class SyncRequest extends FormRequest
{
    /** A batch bigger than this is a malfunctioning till, not a busy shop. */
    public const MAX_OPERATIONS = 50;

    public function authorize(): bool
    {
        // The same permission as ringing a sale, because that is what this is:
        // the sale the cashier already rang, arriving late.
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        $sale = (new StoreSaleRequest)->setUserResolver($this->getUserResolver())->rules();

        unset($sale['idempotency_key'], $sale['cash_session_id']);

        $nested = [];
        foreach ($sale as $field => $rule) {
            $nested["operations.*.sale.{$field}"] = $rule;
        }

        return [
            'device_id' => ['nullable', 'uuid'],
            'operations' => ['required', 'array', 'max:'.self::MAX_OPERATIONS],
            // Minted on the device when Complete was pressed. This is the
            // idempotency key: a lost acknowledgement means the same op arrives
            // again and must return the same sale, not bank the money twice.
            'operations.*.op' => ['required', 'uuid', 'distinct'],
            // When the money crossed the counter. Decides the trading day, the
            // shift and whose figures it lands in — never the sync's own clock.
            'operations.*.at' => ['required', 'date'],
            // What the customer's printed slip says. The server assigns the
            // real invoice number and keeps both, because that slip is the only
            // reference the customer has.
            'operations.*.offline_number' => ['nullable', 'string', 'max:64'],
            // When this device last reached us, so "was this past the shop's
            // window" is measured from the right end.
            'operations.*.offline_since' => ['nullable', 'date'],
            // What the till believed it was standing at: a practice drawer or
            // a real one. It can only ever REFUSE training, never grant it —
            // see the veto in `CreateSaleAction`. Absent counts as "real",
            // because a sale wrongly shown is fixable and one wrongly hidden
            // is not.
            'operations.*.training' => ['nullable', 'boolean'],
            'operations.*.sale' => ['required', 'array'],
            // See the class note: kept, but no longer required to be open.
            'operations.*.sale.cash_session_id' => ['nullable', 'uuid'],
        ] + $nested;
    }
}
