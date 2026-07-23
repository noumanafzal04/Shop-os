<?php

namespace App\Http\Resources;

use App\Models\Tenant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Tenant
 */
class TenantResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'business_name' => $this->business_name,
            'slug' => $this->slug,
            'email' => $this->email,
            'phone' => $this->phone,
            'business_type' => $this->business_type,
            'business_category' => $this->business_category,
            'delivery_fee' => $this->delivery_fee,
            'city' => $this->whenLoaded('city', fn () => [
                'id' => $this->city->id,
                'name' => $this->city->name,
            ]),
            'plan' => $this->whenLoaded('plan', fn () => [
                'id' => $this->plan->id,
                'name' => $this->plan->name,
                'code' => $this->plan->code,
            ]),
            'online_shop_enabled' => $this->online_shop_enabled,
            'features' => $this->features ?? [],
            // Convenience flag: images on when the module is on OR the shop
            // sells online (online listings must show photos).
            'images_enabled' => $this->imagesEnabled(),
            'status' => $this->status,
            'setup_completed' => $this->setup_completed,
            'subscription_ends_at' => $this->subscription_ends_at?->toIso8601String(),
            'subscription_expired' => $this->subscriptionExpired(),
            'subscription_state' => $this->subscriptionState(),
            'grace_ends_at' => $this->graceEndsAt()?->toIso8601String(),
            'logo_path' => $this->logo_path,
            'address' => $this->address,
            'latitude' => $this->latitude !== null ? (float) $this->latitude : null,
            'longitude' => $this->longitude !== null ? (float) $this->longitude : null,
            'business_hours' => $this->business_hours,
            'users' => UserResource::collection($this->whenLoaded('users')),
            'deleted_at' => $this->deleted_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
