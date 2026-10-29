<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Support\Facades\Storage;

/**
 * Platform announcement (admin broadcast). NOT tenant-scoped — created at the
 * platform level and pushed via FCM to a chosen audience. Created as a draft,
 * then explicitly "sent", which fans out one notification per recipient.
 */
class Announcement extends BaseModel
{
    // There is no unsend: who wrote it, who changed it and when it went out
    // (`is_published`, `recipients_count`) are kept (admin #AD7).
    use Auditable;

    protected $appends = ['image_url'];

    protected function casts(): array
    {
        return [
            'is_published' => 'boolean',
            'published_at' => 'datetime',
            'recipients_count' => 'integer',
        ];
    }

    protected function imageUrl(): Attribute
    {
        return Attribute::get(
            fn (): ?string => $this->image_path ? Storage::disk('public')->url($this->image_path) : null,
        );
    }
}
