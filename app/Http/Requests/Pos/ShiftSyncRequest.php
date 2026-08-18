<?php

namespace App\Http\Requests\Pos;

use App\Models\CashMovement;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A batch of shift events that happened with no server.
 *
 * ── Why the session id comes from the till ──────────────────────────────
 *
 * A shift opened offline has to have an id BEFORE it reaches us, because the
 * sales rung into it already name one. If the server minted it on arrival,
 * every queued sale would point at nothing and the whole shift would have to be
 * rewritten on the way in — which is the class of repair this design refuses to
 * do anywhere else either.
 *
 * A uuid does not collide, so the reason the offline RECEIPT number needed its
 * own `OFF-…` scheme does not apply: an invoice number is a human-readable
 * position in one shop-wide sequence, and two tills would both take the next
 * one. An id is not a sequence.
 *
 * ── Why `at` is required on every operation ─────────────────────────────
 *
 * A shift opened on Tuesday and synced on Friday belongs to Tuesday. Taking the
 * arrival time would move a whole day's takings into the wrong trading day, and
 * silently — the figures would all still add up.
 */
class ShiftSyncRequest extends FormRequest
{
    /** A batch bigger than this is a malfunctioning till, not a busy shop. */
    public const MAX_OPERATIONS = 50;

    public function authorize(): bool
    {
        // The same permission as opening a shift at the counter, because that
        // is what this is: the shift the cashier already opened, arriving late.
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        return [
            'device_id' => ['nullable', 'uuid'],
            'operations' => ['required', 'array', 'min:1', 'max:'.self::MAX_OPERATIONS],

            // Minted on the device when the cashier acted. The idempotency key:
            // a lost acknowledgement means this arrives twice and must not open
            // two shifts or count one drawer twice.
            'operations.*.op' => ['required', 'string', 'max:64'],
            'operations.*.kind' => ['required', 'in:open,movement,close'],
            'operations.*.at' => ['required', 'date'],
            'operations.*.session_id' => ['required', 'uuid'],

            // ── open ──
            'operations.*.opening_float' => ['required_if:operations.*.kind,open', 'numeric', 'min:0', 'max:99999999'],
            'operations.*.register_id' => ['nullable', 'uuid'],
            'operations.*.is_training' => ['sometimes', 'boolean'],
            'operations.*.denominations' => ['sometimes', 'array'],
            'operations.*.denominations.*' => ['integer', 'min:0', 'max:100000'],

            // ── movement ──
            // Only the MANUAL types. A system movement is written by the flow
            // that moved the money — a till may not claim one happened.
            'operations.*.type' => ['required_if:operations.*.kind,movement', 'in:'.implode(',', CashMovement::MANUAL_TYPES)],
            'operations.*.amount' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'operations.*.reason' => ['nullable', 'string', 'max:191'],
            'operations.*.note' => ['nullable', 'string', 'max:500'],

            // ── close ──
            'operations.*.counted_cash' => ['required_if:operations.*.kind,close', 'numeric', 'min:0', 'max:99999999'],
            'operations.*.notes' => ['nullable', 'string', 'max:500'],
            'operations.*.declared_tenders' => ['sometimes', 'array'],
            'operations.*.declared_tenders.*' => ['numeric', 'min:0', 'max:99999999'],
        ];
    }
}
