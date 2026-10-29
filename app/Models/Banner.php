<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

/**
 * Platform promo banner (paid ad). NOT tenant-scoped — admin-managed at the
 * platform level; `tenant_id` is the advertiser, not an ownership scope.
 */
class Banner extends BaseModel
{
    // What every customer sees, and what an advertiser paid for (admin #AD7).
    use Auditable;

    /** Customers seeing and tapping it is not a change anybody made. */
    protected function auditQuiet(): array
    {
        return ['impression_count', 'click_count'];
    }

    /**
     * A platform act: `tenant_id` is the advertiser, and the console's work on
     * an ad is not a line in that shop's own trail.
     */
    protected function auditTenantId(): ?string
    {
        return null;
    }

    protected $appends = ['image_url'];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'sort_order' => 'integer',
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'amount' => 'decimal:2',
            'paid_at' => 'datetime',
            'impression_count' => 'integer',
            'click_count' => 'integer',
        ];
    }

    public function advertiser(): BelongsTo
    {
        return $this->belongsTo(Tenant::class, 'tenant_id');
    }

    public function targetProduct(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'target_product_id')->withoutGlobalScopes();
    }

    protected function imageUrl(): Attribute
    {
        return Attribute::get(
            fn (): ?string => $this->image_path ? Storage::disk('public')->url($this->image_path) : null,
        );
    }

    /** Active + within its scheduling window right now. */
    public function scopeLive(Builder $query): Builder
    {
        $now = now();

        return $query->where('is_active', true)
            ->where(fn ($q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now))
            ->where(fn ($q) => $q->whereNull('ends_at')->orWhere('ends_at', '>=', $now));
    }
}
