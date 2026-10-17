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

    /**
     * What ONE sale in the batch must be — the online sale's own rules, less
     * the two the envelope answers. Checked per sale by PosSyncController, NOT
     * here: as nested rules they failed the whole request for one bad sale. A
     * product deleted while a till was offline turned all fifty into a 422,
     * retried for ever and never recorded (tester pass 3, B48).
     *
     * Still the gate on price: these rules carry no `unit_price`, and only what
     * they validate reaches the sale.
     *
     * @return array<string, mixed>
     */
    public function saleRules(): array
    {
        $sale = (new StoreSaleRequest)->setUserResolver($this->getUserResolver())->rules();

        unset($sale['idempotency_key']);
        // Kept, not required to be open — see the class note.
        $sale['cash_session_id'] = ['nullable', 'uuid'];

        return $sale;
    }

    public function rules(): array
    {
        return [
            'device_id' => ['nullable', 'uuid'],
            'operations' => ['required', 'array', 'max:'.self::MAX_OPERATIONS],
            // Minted on the device when Complete was pressed. This is the
            // idempotency key: a lost acknowledgement means the same op arrives
            // again and must return the same sale, not bank the money twice.
            'operations.*.op' => ['required', 'uuid', 'distinct'],
            // When the money crossed the counter. Decides the trading day, the
            // shift and whose figures it lands in — never the sync's own clock.
            // Already corrected by the till for its own measured drift; the
            // server bounds it again on arrival. See `PosSyncController::when`.
            'operations.*.at' => ['required', 'date'],
            // What the tablet's own clock said, uncorrected. Never used for a
            // figure — it is how a shop finds out a till is three days behind
            // instead of the software quietly papering over it every morning.
            'operations.*.client_at' => ['nullable', 'date'],
            // The cashier who rang it, which is not the login flushing the
            // queue — see `PosSyncController::rungBy`. Checked to be a live
            // user of this shop; anything else falls back to the sender.
            'operations.*.rung_by' => ['nullable', 'uuid'],
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
            // What the till charged for each line, in the sale's own order
            // (Q10). Kept only by the sync path, only on a line that names the
            // same product, and every difference is noted for the owner.
            // What the till said the sale came to — kept only if it is refused,
            // so the owner can read how much sits in a drawer with no sale (B49).
            'operations.*.till_total' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'operations.*.till_prices' => ['nullable', 'array', 'max:500'],
            'operations.*.till_prices.*' => ['nullable', 'array'],
            'operations.*.till_prices.*.product_id' => ['nullable', 'uuid'],
            'operations.*.till_prices.*.variant_id' => ['nullable', 'uuid'],
            // The pack the till charged for (L20): a carton's price is the
            // carton's, and it is kept only on a line sold in that same pack.
            'operations.*.till_prices.*.product_unit_id' => ['nullable', 'uuid'],
            'operations.*.till_prices.*.unit_price' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
        ];
    }
}
