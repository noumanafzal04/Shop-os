<?php

namespace App\Models;

use App\Enums\RiderDocumentType;
use App\Enums\RiderStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A person who rides. See the `rider_profiles` migration for why this is not
 * the same thing as a `Rider`.
 *
 * NO `BelongsToTenant`. Everything that reads an order through this model has
 * to fence it by hand — `cards()` is that fence, and every job query in
 * `RiderService` goes through it.
 */
class RiderProfile extends Model
{
    use HasUuids, SoftDeletes;

    protected $guarded = ['id'];

    /**
     * The national ID number never leaves the server by accident. Serializers
     * in this app allow-list rather than exclude, so this is a second lock on
     * the one field where a slip is identity theft rather than an untidy
     * payload.
     */
    protected $hidden = ['cnic'];

    protected function casts(): array
    {
        return [
            'status' => RiderStatus::class,
            'is_platform' => 'boolean',
            'is_online' => 'boolean',
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'last_seen_at' => 'datetime',
            'applied_at' => 'datetime',
            'approved_at' => 'datetime',
        ];
    }

    /**
     * A rider is stale when their phone stopped saying so.
     *
     * "Online" is a switch they flipped, possibly yesterday, possibly before
     * the battery died. Availability asks both this and the switch, so a shop
     * is never offered somebody who is not actually holding a phone.
     */
    public const STALE_AFTER_MINUTES = 5;

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(RiderDocument::class);
    }

    /**
     * The shop-side cards that ARE this person — one per shop they ride for.
     *
     * This is the fence. `Rider` is tenant-scoped, so reading it normally
     * inside a rider's own request would answer for whatever tenant the
     * request resolved (none), which is why every caller reaches for
     * `withoutTenancy()` and then filters by this profile.
     */
    public function cards(): HasMany
    {
        return $this->hasMany(Rider::class)->withoutGlobalScopes();
    }

    public function isAvailable(): bool
    {
        return $this->status->canRide()
            && $this->is_online
            && $this->last_seen_at !== null
            && $this->last_seen_at->gt(now()->subMinutes(self::STALE_AFTER_MINUTES));
    }

    /**
     * The document types this rider still has to supply.
     *
     * @return list<string>
     */
    public function missingDocuments(): array
    {
        // `type` is cast to an enum, so plucking it and comparing against the
        // string list below matched NOTHING and every applicant was told they
        // were missing every document they had just uploaded.
        $have = $this->documents
            ->reject(fn (RiderDocument $d) => $d->status === 'rejected')
            ->map(fn (RiderDocument $d) => $d->type->value)
            ->all();

        return collect(RiderDocumentType::requiredFor($this->vehicle_type))
            ->map(fn (RiderDocumentType $t) => $t->value)
            ->reject(fn (string $t) => in_array($t, $have, strict: true))
            ->values()
            ->all();
    }
}
