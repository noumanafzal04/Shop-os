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
            'online_shop_enabled' => $this->online_shop_enabled,
            'grace_period_days' => $this->grace_period_days,
            'features' => $this->features,
            'is_active' => $this->is_active,
            'tenants_count' => $this->whenCounted('tenants'),
        ];
    }
}
