<?php

namespace App\Models;

use App\Enums\ItemType;
use App\Models\Concerns\BelongsToTenant;
use App\Models\Concerns\HidesCostPrice;
use App\Support\ItemTypes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The universal catalog Item. `item_type` (physical_product | food_item |
 * medicine | service) unlocks capabilities via App\Support\ItemTypes; the
 * coarse `type` (product|service) drives stock/sale plumbing and is derived
 * from item_type.
 */
class Product extends BaseModel
{
    use BelongsToTenant;
    use HidesCostPrice;

    protected function casts(): array
    {
        return [
            'type' => ItemType::class,
            'price' => 'decimal:2',
            'cost' => 'decimal:2',
            'discount_price' => 'decimal:2',
            'wholesale_price' => 'decimal:2',
            'price_tiers' => 'array',
            'min_order_qty' => 'decimal:3',
            'tax_rate' => 'decimal:2',
            'attributes' => 'array',
            'stock_quantity' => 'decimal:3',
            'low_stock_threshold' => 'decimal:3',
            'track_inventory' => 'boolean',
            'duration_minutes' => 'integer',
            'is_active' => 'boolean',
            'visible_in_marketplace' => 'boolean',
            'requires_prescription' => 'boolean',
            'tracks_serial' => 'boolean',
            'warranty_months' => 'integer',
        ];
    }

    public function barcodes(): HasMany
    {
        return $this->hasMany(ProductBarcode::class);
    }

    /** Larger packs this item can be sold in (pack-breaking) — smallest first. */
    public function units(): HasMany
    {
        return $this->hasMany(ProductUnit::class)->orderBy('factor');
    }

    /** The component products inside this deal (only for item_type = deal). */
    public function comboItems(): HasMany
    {
        return $this->hasMany(ComboItem::class, 'combo_product_id')->orderBy('sort_order');
    }

    /** Is this item a combo/deal (a bundle of other products at one price)? */
    public function isCombo(): bool
    {
        return $this->item_type === ItemTypes::DEAL;
    }

    /**
     * Must every batch/lot of this item carry an expiry date? True for
     * medicines — a pharmacy lot without an expiry can't be FEFO-depleted or
     * fenced when expired, so the date is mandatory when receiving the stock.
     */
    public function requiresExpiry(): bool
    {
        return $this->item_type === ItemTypes::MEDICINE;
    }

    /**
     * Does selling this item capture a per-unit serial / IMEI? True for
     * serialized retail goods (phones, electronics) so the POS prompts for one
     * serial per unit and each is recorded for warranty lookup.
     */
    public function tracksSerial(): bool
    {
        return (bool) $this->tracks_serial;
    }

    /** The raw ingredients this dish consumes when sold (recipe / BOM). */
    public function recipeItems(): HasMany
    {
        return $this->hasMany(RecipeItem::class, 'dish_product_id')->orderBy('sort_order');
    }

    /** Is this dish made from a recipe — selling it depletes ingredients? */
    public function hasRecipe(): bool
    {
        return $this->recipeItems()->exists();
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function taxGroup(): BelongsTo
    {
        return $this->belongsTo(TaxGroup::class);
    }

    /**
     * The effective tax percent for this product: its tax group's rate if it's
     * on one, else its own tax_rate, else the shop default. 0 = exempt. The
     * group wins even when the raw tax_rate is also set, so re-rating a group
     * moves every product on it.
     */
    public function effectiveTaxRate(float $default = 0.0): float
    {
        if ($this->tax_group_id !== null) {
            $rate = $this->taxGroup?->rate;
            if ($rate !== null) {
                return (float) $rate;
            }
        }

        return $this->tax_rate !== null ? (float) $this->tax_rate : $default;
    }

    public function collections(): BelongsToMany
    {
        return $this->belongsToMany(Collection::class, 'collection_item')
            ->withPivot('sort_order')
            ->withTimestamps();
    }

    public function variants(): HasMany
    {
        return $this->hasMany(ProductVariant::class)->orderBy('name');
    }

    public function modifierGroups(): HasMany
    {
        return $this->hasMany(ModifierGroup::class)->orderBy('sort_order');
    }

    public function batches(): HasMany
    {
        // FEFO order: earliest expiry first, undated batches last.
        return $this->hasMany(ProductBatch::class)
            ->orderByRaw('expiry_date IS NULL, expiry_date');
    }

    /**
     * The price a buyer actually pays: the sale price when one is set below
     * the regular price, otherwise the regular price. Variant prices are not
     * discounted (discount_price is product-level).
     */
    public function sellingPrice(): float
    {
        $price = (float) $this->price;
        $sale = $this->discount_price !== null ? (float) $this->discount_price : null;

        return $sale !== null && $sale > 0 && $sale < $price ? $sale : $price;
    }

    /**
     * Quantity-aware price: the deepest price_tiers break the quantity
     * qualifies for ([{min_qty, price}], wholesale), otherwise sellingPrice().
     */
    public function priceForQty(float $qty): float
    {
        $bestPrice = null;
        foreach ($this->price_tiers ?? [] as $tier) {
            $min = (float) ($tier['min_qty'] ?? 0);
            $price = (float) ($tier['price'] ?? 0);
            // Among EVERY tier the quantity qualifies for, charge the cheapest —
            // not simply the deepest min_qty. Validation keeps tiers monotonic,
            // but should a non-monotonic set slip in (legacy data, a deeper tier
            // priced higher), the buyer still can't be overcharged past a
            // shallower, cheaper break.
            if ($min > 0 && $price > 0 && $qty >= $min && ($bestPrice === null || $price < $bestPrice)) {
                $bestPrice = $price;
            }
        }

        // The customer always pays the LOWER of the qualifying wholesale tier
        // and any active sale price — a bulk tier must never override a deeper
        // flash-sale discount into an overcharge.
        return $bestPrice !== null ? min($bestPrice, $this->sellingPrice()) : $this->sellingPrice();
    }

    /** Does this item have a wholesale price list (a distinct lower rate)? */
    public function hasWholesalePrice(): bool
    {
        return $this->wholesale_price !== null && (float) $this->wholesale_price > 0;
    }

    /**
     * Per-unit price for a chosen price LEVEL. "wholesale" uses the flat
     * wholesale rate (a price list — quantity tiers don't stack on top of it);
     * "retail" (or wholesale with no rate set) uses the normal quantity-aware
     * price. The customer is never overcharged: wholesale can't exceed retail.
     */
    public function priceForLevel(string $level, float $qty): float
    {
        if ($level === 'wholesale' && $this->hasWholesalePrice()) {
            return min((float) $this->wholesale_price, $this->priceForQty($qty));
        }

        return $this->priceForQty($qty);
    }

    /**
     * Within its serving window right now? Items with no window are always
     * available; a window that wraps midnight (e.g. 22:00–02:00) is handled.
     * The comparison is in the SHOP's wall-clock — pass the tenant's timezone
     * (a "07:00–11:00 breakfast" item must open at 07:00 local, not 07:00 UTC).
     */
    public function isAvailableNow(?string $timezone = null): bool
    {
        if ($this->available_from === null || $this->available_until === null) {
            return true;
        }
        $tz = $timezone
            ?? ($this->relationLoaded('tenant') ? $this->tenant?->timezone : null)
            ?? 'Asia/Karachi';
        $now = now()->setTimezone($tz)->format('H:i:s');
        $from = (string) $this->available_from;
        $until = (string) $this->available_until;

        return $from <= $until
            ? $now >= $from && $now <= $until
            : $now >= $from || $now <= $until; // wraps midnight
    }

    public function images(): HasMany
    {
        return $this->hasMany(ProductImage::class)->orderBy('sort_order');
    }

    /** Capability descriptor for this item's type. */
    public function capabilities(): array
    {
        return ItemTypes::get($this->item_type) ?? ItemTypes::get(ItemTypes::PHYSICAL);
    }

    public function supports(string $capability): bool
    {
        return ItemTypes::supports($this->item_type ?? ItemTypes::PHYSICAL, $capability);
    }

    public function isService(): bool
    {
        return $this->type === ItemType::Service;
    }

    /**
     * The stock that actually counts for this product. A product WITH variants
     * holds no stock of its own — its real quantity is the SUM across variants,
     * and the parent stock_quantity is an orphaned leftover that must not be
     * read as truth (low-stock reports, marketplace availability). A product
     * without variants uses its own stock_quantity.
     */
    public function effectiveStock(): float
    {
        $variants = $this->relationLoaded('variants')
            ? $this->variants
            : $this->variants()->get(['id', 'product_id', 'stock_quantity']);

        if ($variants->isNotEmpty()) {
            return (float) $variants->sum(fn ($v) => (float) $v->stock_quantity);
        }

        return (float) $this->stock_quantity;
    }

    public function isLowStock(): bool
    {
        return $this->track_inventory
            && $this->low_stock_threshold !== null
            && $this->effectiveStock() <= (float) $this->low_stock_threshold;
    }
}
