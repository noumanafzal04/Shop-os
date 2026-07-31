<?php

namespace App\Http\Requests\Customer;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCustomerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::CUSTOMERS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $id = $this->route('customer');

        return [
            'name' => ['sometimes', 'required', 'string', 'max:191'],
            'phone' => [
                'nullable', 'string', 'max:32',
                Rule::unique('customers', 'phone')->where('tenant_id', $tenantId)->ignore($id)->whereNull('deleted_at'),
            ],
            'email' => ['nullable', 'email', 'max:191'],
            'address' => ['nullable', 'string', 'max:500'],
            'notes' => ['nullable', 'string', 'max:1000'],
            // Optional cap on how much this customer may owe on khata.
            'credit_limit' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'customer_group_id' => [
                'nullable', 'uuid',
                Rule::exists('customer_groups', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
        ];
    }
}
