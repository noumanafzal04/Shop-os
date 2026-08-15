<?php

namespace App\Http\Requests\Bank;

use App\Models\BankCardOffer;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * One bank campaign — "HBL Ramadan 10%".
 *
 * ── The cap is warned about, not enforced ───────────────────────────────
 *
 * An uncapped percentage is a real arrangement (many are), so refusing one
 * would refuse a deal the shop actually signed. But ten per cent of a
 * Rs 400,000 sale is a number neither side pictured when they agreed to "10%
 * off", and the shop finds out when the bank rejects the claim. The screen
 * carries the warning; the rule stays permissive, because the shop knows its
 * own contract and this file does not.
 */
class StoreBankOfferRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::COUPONS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $creating = $this->isMethod('POST');

        return [
            'bank_id' => [
                $creating ? 'required' : 'sometimes',
                'uuid',
                Rule::exists('banks', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            // What the cashier picks from and what the claim is filed under, so
            // "Offer 1" is a label somebody will regret in March.
            'label' => [$creating ? 'required' : 'sometimes', 'string', 'max:80'],
            'type' => [$creating ? 'required' : 'sometimes', Rule::in(BankCardOffer::TYPES)],
            'value' => [$creating ? 'required' : 'sometimes', 'numeric', 'min:0.01'],
            'min_spend' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'max_discount' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'card_types' => ['sometimes', 'nullable', 'array'],
            'card_types.*' => [Rule::in(BankCardOffer::CARD_TYPES)],
            // The campaign window — the same four fields a promotion carries,
            // read by the same code. See App\Support\OfferWindow.
            'starts_on' => ['sometimes', 'nullable', 'date'],
            'ends_on' => ['sometimes', 'nullable', 'date', 'after_or_equal:starts_on'],
            'days_of_week' => ['sometimes', 'nullable', 'array'],
            'days_of_week.*' => ['integer', 'between:0,6'],
            // Both ends or neither: one alone says nothing about a window, and
            // guessing the other end is how an offer runs for a minute a day.
            //
            // Deliberately NOT `sometimes`. `sometimes` only runs a rule when
            // the key is present, so `sometimes|required_with` can never fire —
            // the exact case it is meant to catch is a MISSING key. It shipped
            // that way for about ten minutes and a test caught it.
            'start_time' => ['nullable', 'date_format:H:i,H:i:s', 'required_with:end_time'],
            'end_time' => ['nullable', 'date_format:H:i,H:i:s', 'required_with:start_time'],
            'priority' => ['sometimes', 'integer'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
