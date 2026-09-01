<?php

namespace App\Http\Requests\Customer;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCustomerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::CUSTOMERS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'name' => ['required', 'string', 'max:191'],
            'phone' => [
                'nullable', 'string', 'max:32',
                Rule::unique('customers', 'phone')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'email' => ['nullable', 'email', 'max:191'],
            'address' => ['nullable', 'string', 'max:500'],
            'notes' => ['nullable', 'string', 'max:1000'],
            // Optional cap on how much this customer may owe on khata.
            'credit_limit' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            // Optional pricing/discount tier.
            'customer_group_id' => [
                'nullable', 'uuid',
                Rule::exists('customer_groups', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
        ];
    }

    /**
     * A KHATA NEEDS A PHONE.
     *
     * Every path that puts a name to a sale keys off the number and nothing
     * else: `StoreSaleRequest` carries `customer_phone` and no `customer_id`,
     * the group discount is looked up by phone, so is the loyalty balance, and
     * so is `Customer::capture`. Loyalty already says it out loud — *"Redeeming
     * points needs a customer — add the customer's phone."*
     *
     * The CRM form did not. `Phone` sat as a plain optional box directly beside
     * `Credit limit (khata) — blank = no limit`, so a shop could grant fifty
     * thousand rupees of credit to somebody the counter can never name. That is
     * not a customer who is awkward to bill; it is money that cannot be lent,
     * repaid or chased, and nothing said so until a cashier was standing at the
     * till with the customer in front of them.
     *
     * A customer with no number is still perfectly fine — plenty of shops keep
     * a directory of walk-in names. The LIMIT is what needs reaching them.
     */
    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            if (! $this->wantsCredit()) {
                return;
            }

            if (trim((string) $this->effectivePhone()) === '') {
                $v->errors()->add(
                    'phone',
                    'A khata needs a phone number — the till finds a customer by their number, '
                    .'so a credit limit without one can never be used.',
                );
            }
        });
    }

    private function wantsCredit(): bool
    {
        return (float) $this->input('credit_limit', 0) > 0;
    }

    private function effectivePhone(): ?string
    {
        return $this->input('phone');
    }

    public function messages(): array
    {
        return ['phone.unique' => 'A customer with this phone already exists.'];
    }
}
