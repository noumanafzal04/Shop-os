<?php

namespace App\Http\Requests\Purchase;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Which of the running-out items to raise orders for.
 *
 * Ids only. Quantities and prices are decided on the server from the shop's own
 * thresholds and purchase history — the same rule every other money path here
 * follows, and for the same reason: a browser that can name its own cost can
 * name a wrong one.
 */
class FromReorderListRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PURCHASES_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'product_ids' => ['required', 'array', 'min:1', 'max:200'],
            'product_ids.*' => [
                'uuid',
                // Scoped to this shop, so a stray id cannot put another
                // tenant's product on this tenant's order.
                Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
        ];
    }
}
