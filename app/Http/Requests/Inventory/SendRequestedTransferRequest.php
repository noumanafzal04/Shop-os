<?php

namespace App\Http\Requests\Inventory;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Answering a request for stock. Only the lines being sent DIFFERENTLY from
 * what was asked need naming: with no body, what was asked for is what goes.
 */
class SendRequestedTransferRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::INVENTORY_MANAGE);
    }

    public function rules(): array
    {
        return [
            'items' => ['nullable', 'array', 'max:200'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'min:0', 'max:100000'],
        ];
    }

    /** @return array<string, float> */
    public function sending(): array
    {
        return collect($this->input('items', []))
            ->mapWithKeys(fn (array $row): array => [$row['id'] => (float) $row['quantity']])
            ->all();
    }
}
