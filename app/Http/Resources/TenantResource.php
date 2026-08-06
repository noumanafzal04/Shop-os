<?php

namespace App\Http\Resources;

use App\Models\Tenant;
use App\Support\BusinessTypes;
use App\Support\Modules;
use App\Support\PlanLimits;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

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
            // The current type this shop's code stands for. Identical to
            // business_type for every type in the picker; for an older code
            // (clinic, workshop, grocery…) it is the type that absorbed it.
            // Anything deciding what the business IS reads this one — the raw
            // code stays for display and for the admin who chose it.
            'business_type_primary' => $this->business_type !== null
                ? BusinessTypes::primary($this->business_type)
                : null,
            'business_category' => $this->business_category,
            // What THIS shop may put in its catalog — its trade crossed with
            // its own module map. Not the same as the `item_types` on
            // /business-types, which describes the type as shipped and knows
            // nothing about a per-tenant module grant. Any screen offering a
            // choice of item type must read this one, or it offers a salon
            // with the products module a list its own server will reject.
            'item_types' => $this->business_type !== null
                ? BusinessTypes::itemTypesFor($this->business_type, $this->moduleMap())
                : [],
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
            // What this shop was assigned: branches, staff and lanes, plus any
            // extension past its plan. Empty = every resource on its default.
            'limits' => $this->limits ?? [],
            // What its type would have proposed — so the admin can see at a
            // glance which modules were a deliberate choice for this shop.
            'default_modules' => Modules::defaultsFor($this->business_type),
            // Live usage-vs-limit — detail view only (loads `users`), to keep
            // the tenant list free of per-row count queries.
            'limits_usage' => $this->when(
                $this->resource->relationLoaded('users'),
                fn () => PlanLimits::snapshot($this->resource),
            ),
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
            // Resolved server-side, like every other image the API hands out
            // (see ProductImage / GalleryImage) — a client that has to assemble
            // a storage URL itself is a client that gets it wrong on the first
            // deployment with a CDN in front.
            'logo_url' => $this->logo_path ? Storage::disk('public')->url($this->logo_path) : null,
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
