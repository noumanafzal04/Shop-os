<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

class GalleryImage extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected $appends = ['url'];

    protected function url(): Attribute
    {
        return Attribute::get(
            fn (): ?string => $this->path ? Storage::disk('public')->url($this->path) : null,
        );
    }
}
