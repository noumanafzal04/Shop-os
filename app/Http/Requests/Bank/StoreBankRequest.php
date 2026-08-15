<?php

namespace App\Http\Requests\Bank;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A bank this shop has a card deal with.
 *
 * The unique rule is not tidiness. Two rows called "HBL" split the claim report
 * in half, and the claim report is the only number this whole feature exists to
 * produce — a shop would invoice for half of what it is owed and never know.
 */
class StoreBankRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Marketing, exactly like promotions and coupons: signing a deal with a
        // bank is not something a cashier does.
        return $this->user()->hasPermission(Permissions::COUPONS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $id = $this->route('bank');

        return [
            'name' => [
                $this->isMethod('POST') ? 'required' : 'sometimes',
                'string',
                'max:80',
                Rule::unique('banks', 'name')
                    ->where(fn ($q) => $q->where('tenant_id', $tenantId))
                    ->ignore($id)
                    ->whereNull('deleted_at'),
            ],
            // Printed on a 32-character receipt line, where "Habib Bank
            // Limited" does not fit and "HBL" does.
            'short_code' => ['sometimes', 'nullable', 'string', 'max:12'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
