<?php

namespace App\Http\Requests\Purchase;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

class ReceivePurchaseOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PURCHASES_MANAGE);
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
            'items' => ['nullable', 'array'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001'],
            'items.*.batch_number' => ['nullable', 'string', 'max:64'],
            'items.*.expiry_date' => ['nullable', 'date'],
        ];
    }

    /** @return array<string, array{quantity: float, batch_number: ?string, expiry_date: ?string}> */
    public function receiveMap(): array
    {
        $map = [];
        foreach ($this->input('items', []) as $row) {
            $map[$row['id']] = [
                'quantity' => (float) $row['quantity'],
                'batch_number' => $row['batch_number'] ?? null,
                'expiry_date' => $row['expiry_date'] ?? null,
            ];
        }

        return $map;
    }
}
