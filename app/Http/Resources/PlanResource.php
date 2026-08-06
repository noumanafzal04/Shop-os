<?php

namespace App\Http\Resources;

use App\Models\Plan;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Plan
 */
class PlanResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'code' => $this->code,
            'description' => $this->description,
            'price' => $this->price,
            'billing_period_months' => $this->billing_period_months,
            'grace_period_days' => $this->grace_period_days,
            // Billed usage ceilings — null = unlimited for that resource.
            // Branches, staff and lanes are assigned per tenant, not here.
            'limits' => [
                'products' => $this->max_products,
                'storage_mb' => $this->max_storage_mb,
                'orders_month' => $this->max_orders_month,
            ],
            'is_active' => $this->is_active,
            // A bespoke deal for one business rather than a rung on the ladder.
            'is_custom' => $this->is_custom,
            'tenants_count' => $this->whenCounted('tenants'),
        ];
    }
}
