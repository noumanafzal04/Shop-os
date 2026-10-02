<?php

namespace App\Http\Requests\Admin;

use App\Support\PlanLimits;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Capacity sold or granted to one shop.
 *
 * The validation that matters is `limit_key`: it is a free string in the
 * database on purpose — the registry grows and a migration per new meter is
 * a migration nobody writes — but a typo'd key here would create a row that
 * grants nothing and explains nothing, for ever, with no error anywhere.
 */
class StoreEntitlementRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'limit_key' => ['required', 'string', Rule::in(array_keys(PlanLimits::REGISTRY))],
            'quantity' => ['required', 'integer', 'min:1', 'max:1000000'],
            /**
             * Nullable, and null is not zero. Zero is "agreed free"; null is
             * "no price was set", and an invoice run has to tell them apart.
             */
            'unit_price' => ['nullable', 'numeric', 'min:0', 'max:9999999'],
            'starts_on' => ['nullable', 'date'],
            // Absent = for ever, which is what an ordinary paid add-on is.
            'ends_on' => ['nullable', 'date', 'after_or_equal:starts_on'],
            'note' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function messages(): array
    {
        return [
            'limit_key.in' => 'That is not something this platform meters.',
            'ends_on.after_or_equal' => 'A grant cannot end before it starts.',
        ];
    }
}
