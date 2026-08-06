<?php

namespace App\Http\Requests\Fuel;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreFuelDeliveryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PURCHASES_MANAGE);
    }

    public function rules(): array
    {
        return [
            'fuel_tank_id' => ['required', 'uuid', Rule::exists('fuel_tanks', 'id')->whereNull('deleted_at')],
            // What the supplier is billing for.
            'invoiced_litres' => ['required', 'numeric', 'gt:0', 'max:9999999'],
            // The station's own measurement. Either the dips either side, or a
            // received figure; without them the invoice is taken on trust.
            'dip_before' => ['nullable', 'required_with:dip_after', 'numeric', 'min:0', 'max:9999999'],
            'dip_after' => ['nullable', 'required_with:dip_before', 'numeric', 'min:0', 'max:9999999'],
            'received_litres' => ['nullable', 'numeric', 'min:0', 'max:9999999'],
            'supplier_id' => ['nullable', 'uuid', Rule::exists('suppliers', 'id')->whereNull('deleted_at')],
            'invoice_number' => ['nullable', 'string', 'max:64'],
            'tanker_number' => ['nullable', 'string', 'max:64'],
            'unit_cost' => ['nullable', 'numeric', 'min:0', 'max:999999'],
            'received_at' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
