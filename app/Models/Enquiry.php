<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Somebody on the landing page asking for a person.
 *
 * Not tenant-scoped, and it cannot be: whoever fills this in has no shop yet.
 * It is written by a stranger and read by the platform admin, which is exactly
 * the shape of `ShopRequest` and for the same reason.
 */
class Enquiry extends Model
{
    use HasUuids;

    public const WALKTHROUGH = 'walkthrough';

    public const QUESTION = 'question';

    public const NEW = 'new';

    public const CONTACTED = 'contacted';

    public const CLOSED = 'closed';

    /** @var list<string> */
    public const KINDS = [self::WALKTHROUGH, self::QUESTION];

    /** @var list<string> */
    public const STATUSES = [self::NEW, self::CONTACTED, self::CLOSED];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'prefers_at' => 'datetime',
            'handled_at' => 'datetime',
        ];
    }

    public function handler(): BelongsTo
    {
        return $this->belongsTo(User::class, 'handled_by');
    }

    /** Still waiting on somebody. */
    public function scopeOpen($query)
    {
        return $query->whereIn('status', [self::NEW, self::CONTACTED]);
    }
}
