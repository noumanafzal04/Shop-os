<?php

namespace App\Models;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Concerns\Auditable;
use App\Models\Concerns\HasAuditFields;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use Auditable, HasApiTokens, HasAuditFields, HasFactory, HasUuids, Notifiable, SoftDeletes;

    protected $fillable = [
        'tenant_id',
        'branch_id',
        'name',
        'email',
        'phone',
        'password',
        'role',
        'status',
        'permissions',
        'email_verified_at',
        'phone_verified_at',
        'last_login_at',
        'failed_login_attempts',
        'locked_until',
    ];

    protected $hidden = [
        'password',
        'remember_token',
        'pin_hash',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'phone_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'locked_until' => 'datetime',
            'pin_set_at' => 'datetime',
            'pin_locked_until' => 'datetime',
            'password' => 'hashed',
            'role' => UserRole::class,
            'status' => UserStatus::class,
            'permissions' => 'array',
        ];
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** The branch this staff member is assigned to (null = all, for owners). */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === UserRole::SuperAdmin;
    }

    public function isShopOwner(): bool
    {
        return $this->role === UserRole::ShopOwner;
    }

    public function isCustomer(): bool
    {
        return $this->role === UserRole::Customer;
    }

    public function isActive(): bool
    {
        return $this->status === UserStatus::Active;
    }

    public function isLocked(): bool
    {
        return $this->locked_until !== null && $this->locked_until->isFuture();
    }

    /**
     * Scope owners (super_admin, shop_owner) implicitly hold every permission
     * in their scope; staff roles hold only what they were assigned.
     */
    public function hasPermission(string $permission): bool
    {
        return match ($this->role) {
            UserRole::SuperAdmin, UserRole::ShopOwner => true,
            UserRole::AdminStaff, UserRole::Staff => in_array($permission, $this->permissions ?? [], strict: true),
            UserRole::Customer => false,
        };
    }

    // ── Till PIN ────────────────────────────────────────────────────
    // A counter credential, not a login. See the add_till_pins migration for
    // why a four-digit secret is safe in this one place and nowhere else.

    /** Wrong PINs in a row before the PIN (not the account) is frozen. */
    public const MAX_PIN_ATTEMPTS = 5;

    public const PIN_LOCKOUT_MINUTES = 15;

    public function hasPin(): bool
    {
        return $this->pin_hash !== null;
    }

    public function isPinLocked(): bool
    {
        return $this->pin_locked_until !== null && $this->pin_locked_until->isFuture();
    }

    public function setPin(string $pin): void
    {
        $this->forceFill([
            'pin_hash' => Hash::make($pin),
            'pin_set_at' => now(),
            'pin_failed_attempts' => 0,
            'pin_locked_until' => null,
        ])->save();
    }

    public function clearPin(): void
    {
        $this->forceFill([
            'pin_hash' => null,
            'pin_set_at' => null,
            'pin_failed_attempts' => 0,
            'pin_locked_until' => null,
        ])->save();
    }

    /**
     * Check a PIN and record the attempt. Returns false for a user with no PIN
     * at all, so "no PIN set" and "wrong PIN" are indistinguishable from the
     * till — the roster already says who has one.
     */
    public function checkPin(string $pin): bool
    {
        if (! $this->hasPin()) {
            return false;
        }

        if (Hash::check($pin, $this->pin_hash)) {
            if ($this->pin_failed_attempts > 0 || $this->pin_locked_until !== null) {
                $this->forceFill(['pin_failed_attempts' => 0, 'pin_locked_until' => null])->save();
            }

            return true;
        }

        $attempts = $this->pin_failed_attempts + 1;
        $this->forceFill([
            'pin_failed_attempts' => $attempts,
            'pin_locked_until' => $attempts >= self::MAX_PIN_ATTEMPTS
                ? now()->addMinutes(self::PIN_LOCKOUT_MINUTES)
                : null,
        ])->save();

        return false;
    }
}
