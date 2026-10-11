<?php

namespace App\Http\Requests\Inventory;

use App\Models\StockTransfer;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SettleTransferRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::INVENTORY_MANAGE);
    }

    public function rules(): array
    {
        return [
            // What became of everything that did not arrive…
            'outcome' => ['required', Rule::in(StockTransfer::SHORT_OUTCOMES)],
            // …unless one line had a different fate from the rest.
            'items' => ['nullable', 'array', 'max:200'],
            'items.*.id' => ['required', 'uuid'],
            'items.*.outcome' => ['required', Rule::in(StockTransfer::SHORT_OUTCOMES)],
        ];
    }

    /** @return array<string, string> */
    public function perItem(): array
    {
        return collect($this->input('items', []))->pluck('outcome', 'id')->all();
    }
}
