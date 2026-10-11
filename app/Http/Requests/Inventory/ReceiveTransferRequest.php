<?php

namespace App\Http\Requests\Inventory;

use App\Models\StockTransfer;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ReceiveTransferRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::INVENTORY_MANAGE);
    }

    public function rules(): array
    {
        // Only the lines that did NOT arrive whole need naming. A transfer
        // received with no body arrived as it was sent.
        return [
            'items' => ['nullable', 'array', 'max:200'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.quantity_received' => ['required', 'numeric', 'min:0', 'max:100000'],
            'items.*.short_reason' => ['nullable', Rule::in(StockTransfer::SHORT_REASONS)],
        ];
    }

    /** @return array<string, array{quantity_received: float, short_reason: ?string}> */
    public function counted(): array
    {
        $counted = [];
        foreach ($this->input('items', []) as $row) {
            $counted[$row['id']] = [
                'quantity_received' => (float) $row['quantity_received'],
                'short_reason' => $row['short_reason'] ?? null,
            ];
        }

        return $counted;
    }
}
