<?php

namespace App\Http\Requests\Inventory;

use App\Models\ProductBatch;
use App\Models\StockDisposal;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Removing a batch, and the one thing that must be said about it.
 *
 * ── Why the disposition is conditionally required ───────────────────────
 *
 * An EMPTY batch is housekeeping: a lot keyed with the wrong number, a line
 * being tidied. Demanding a reason for that would train a pharmacist to pick
 * whatever clears the dialogue fastest, and a field answered that way is worse
 * than no field.
 *
 * A batch with stock in it is a different act. Forty strips of medicine do not
 * disappear; they are binned or they go back to the distributor. Those are
 * opposite facts about the same money — one is a loss and one is a claim — and
 * the platform recorded neither until it started asking.
 *
 * ── A return names its supplier ─────────────────────────────────────────
 *
 * A claim with nobody to claim from is not a claim. `supplier_id` is required
 * exactly where the disposition is a return, and refused where it is not — a
 * write-off has no counterparty, and letting one carry a supplier would put
 * bin-bound stock in a list of money somebody is chasing.
 */
class DisposeBatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::INVENTORY_MANAGE);
    }

    public function rules(): array
    {
        // Nothing on an empty batch has to be explained. This is read from the
        // BATCH and not from the request, so a caller cannot exempt itself by
        // claiming the lot was empty.
        $required = $this->batchHasStock() ? 'required' : 'nullable';

        return [
            'disposition' => [$required, Rule::in(StockDisposal::DISPOSITIONS)],
            'reason' => [$required, Rule::in(StockDisposal::REASONS)],
            'notes' => ['nullable', 'string', 'max:500'],

            'supplier_id' => [
                'nullable',
                'required_if:disposition,'.StockDisposal::RETURNED,
                'uuid',
                Rule::exists('suppliers', 'id')
                    ->where('tenant_id', $this->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
            // What the shop expects back. Optional on purpose: a pharmacist
            // often sends a box back before anyone has agreed what it is worth,
            // and refusing the return until they know would mean the return is
            // recorded nowhere.
            'credit_expected' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
        ];
    }

    private function batchHasStock(): bool
    {
        $batch = ProductBatch::query()->find($this->route('batch'));

        return $batch !== null && (float) $batch->quantity > 0;
    }
}
