<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

class ProductImage extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    /** Expose ready-to-use public URLs to every client. */
    protected $appends = ['url', 'thumb_url'];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    protected function url(): Attribute
    {
        return Attribute::get(
            fn (): ?string => $this->path ? Storage::disk('public')->url($this->path) : null,
        );
    }

    /**
     * The small square, falling back to the original.
     *
     * Falling back rather than returning null is the point: a caller asking for
     * a thumbnail always gets something it can render. A photo uploaded before
     * thumbnails existed, or one GD could not read, still shows — slowly, which
     * is how it showed yesterday, rather than not at all.
     */
    protected function thumbUrl(): Attribute
    {
        return Attribute::get(function (): ?string {
            $path = $this->thumb_path ?: $this->path;

            return $path ? Storage::disk('public')->url($path) : null;
        });
    }
}
