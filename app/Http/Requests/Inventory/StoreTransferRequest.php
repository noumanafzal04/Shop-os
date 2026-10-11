<?php

namespace App\Http\Requests\Inventory;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTransferRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::INVENTORY_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        // A place of this business that is open. A closed one neither sends
        // nor receives: nobody is there to load the van or count it in.
        $place = fn () => Rule::exists('branches', 'id')
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->whereNull('deleted_at');

        return [
            // `send` puts it on the road for the other end to count in.
            // `request` asks the other place for it — nothing moves yet.
            // `move` is both ends at once — and what a caller that names
            // none of them has always meant, so it stays the default.
            'mode' => ['sometimes', Rule::in(['send', 'move', 'request'])],
            'from_branch_id' => ['required', 'uuid', $place()],
            'to_branch_id' => ['required', 'uuid', 'different:from_branch_id', $place()],
            'notes' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => ['required', 'uuid', Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at')],
            'items.*.variant_id' => ['nullable', 'uuid', Rule::exists('product_variants', 'id')->whereNull('deleted_at')],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001', 'max:100000'],
        ];
    }
}
