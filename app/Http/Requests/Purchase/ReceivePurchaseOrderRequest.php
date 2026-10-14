<?php

namespace App\Http\Requests\Purchase;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ReceivePurchaseOrderRequest extends FormRequest
{
    /**
     * The buyer, or the stockroom: the one who checks the goods off the bay.
     * The route already let a stock keeper in (READS_PURCHASE_ORDERS) and the
     * screen offered them Receive — and this refused them with a 403. Zari's
     * stock keeper could open the order and not take the delivery.
     */
    public function authorize(): bool
    {
        return $this->user()->hasAnyPermission(Permissions::PURCHASES_MANAGE, Permissions::INVENTORY_MANAGE);
    }

    public function rules(): array
    {
        // Optional per-line quantities; omit entirely to receive all
        // outstanding. Batch/expiry are optional per line — pharmacies fill
        // them so the receipt lands as a tracked lot.
        return [
            // One key per receipt attempt (client generates it when the
            // dialog opens) → a network retry replays instead of double-receiving.
            'idempotency_key' => ['nullable', 'string', 'max:64'],
            // Which place the delivery is being put into — the shop, or the
            // warehouse behind it. Omitted: the place being worked at, as
            // before. Who may name another is the action's to decide.
            'branch_id' => ['nullable', 'uuid', Rule::exists('branches', 'id')
                ->where('tenant_id', $this->user()->tenant_id)
                ->where('is_active', true)
                ->whereNull('deleted_at')],
            'items' => ['nullable', 'array'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001'],
            'items.*.batch_number' => ['nullable', 'string', 'max:64'],
            'items.*.expiry_date' => ['nullable', 'date'],
            // Serialized goods: the IMEIs/serials of the units received. Each
            // enters stock as an in_stock serial. Distinct within the line.
            'items.*.serials' => ['nullable', 'array'],
            'items.*.serials.*' => ['string', 'max:120', 'distinct'],
        ];
    }

    /** @return array<string, array{quantity: float, batch_number: ?string, expiry_date: ?string, serials: array<int,string>}>|null */
    public function receiveMap(): ?array
    {
        // No list at all: everything still owed arrived (the one-press receive).
        // A list — even an empty one — is the whole of what arrived.
        if (! is_array($this->input('items'))) {
            return null;
        }

        $map = [];
        foreach ($this->input('items', []) as $row) {
            $map[$row['id']] = [
                'quantity' => (float) $row['quantity'],
                'batch_number' => $row['batch_number'] ?? null,
                'expiry_date' => $row['expiry_date'] ?? null,
                'serials' => array_values(array_filter(array_map(
                    fn ($s) => trim((string) $s),
                    $row['serials'] ?? [],
                ), fn ($s) => $s !== '')),
            ];
        }

        return $map;
    }
}
