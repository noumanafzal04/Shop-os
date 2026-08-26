<?php

namespace App\Http\Resources;

use App\Enums\UserRole;
use App\Models\User;
use App\Support\StaffPresets;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin User
 */
class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'role' => $this->role,
            'status' => $this->status,
            // Assigned branch (staff are pinned to it; null = all, for owners).
            'branch_id' => $this->branch_id,
            'permissions' => $this->permissions ?? [],
            // WHAT THIS PERSON DOES, in the word an owner thinks in.
            //
            // Derived from the permissions they hold, never stored — a preset
            // ticks boxes and is forgotten, which is what stops it rotting
            // into a shadow role. One box off the set reads as null, and the
            // screen says "Custom", which is the honest answer.
            //
            // Only for tenant staff: an owner holds everything by role and a
            // platform admin is not doing a shop job, so neither has one.
            'job' => $this->role === UserRole::Staff
                ? (StaffPresets::matching($this->permissions ?? [])['label'] ?? null)
                : null,
            'email_verified' => $this->email_verified_at !== null,
            'phone_verified' => $this->phone_verified_at !== null,
            // Whether a till PIN exists — never the PIN, which is hashed and
            // hidden. The panel needs this to say "Set" vs "Change".
            'has_till_pin' => $this->pin_hash !== null,
            'last_login_at' => $this->last_login_at?->toIso8601String(),
            'tenant' => new TenantResource($this->whenLoaded('tenant')),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
