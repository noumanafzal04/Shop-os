<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The physical thing a till runs on.
 *
 * A Register is a PLACE ("Lane 1"); a PosDevice is a THING. Two tablets can
 * serve one lane and a tablet can be carried between lanes, so neither identity
 * substitutes for the other. It matters for offline selling, where the queue of
 * unsent sales lives on the device: "how long has this been out of contact" and
 * "whose unsent sales are these" are device questions, not lane questions.
 *
 * No soft-deletes: `revoked_at` is this table's retirement, and it is not a
 * deletion. A revoked tablet keeps its row because the sales it already sent
 * still point at it — removing the row would orphan them, and the reason the
 * owner revoked it is exactly what they will want to look up afterwards.
 */
class PosDevice extends Model
{
    use BelongsToTenant;
    use HasUuids;

    // The client mints its own id (see the migration), and HasUuids only fills
    // an empty key, so it survives. Guarding it here would block the assignment
    // that registration depends on, so registration sets it explicitly rather
    // than through mass assignment.
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function register(): BelongsTo
    {
        return $this->belongsTo(Register::class);
    }

    public function revokedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'revoked_by');
    }

    /** Devices still allowed to be used. */
    public function scopeLive(Builder $query): Builder
    {
        return $query->whereNull('revoked_at');
    }

    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }

    /**
     * Whole days since this device last reached the server.
     *
     * A device that has never been seen reads 0 rather than infinity: it was
     * created by a request that reached the server, so "never seen" only ever
     * means the row was written by hand.
     */
    public function daysOffline(): int
    {
        if ($this->last_seen_at === null) {
            return 0;
        }

        // floor, not round: a device 47 hours out is one day out, not two. The
        // policy is a ceiling and must not trip early on a rounding artefact.
        return max(0, (int) floor($this->last_seen_at->diffInDays(now())));
    }
}
