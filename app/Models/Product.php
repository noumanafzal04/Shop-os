<?php

namespace App\Models;

use App\Enums\ItemType;
use App\Models\Concerns\Auditable;
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
    use Auditable;
    use BelongsToTenant;
    use HidesCostPrice;

    /**
     * WHAT THIS ITEM USED TO COST THE CUSTOMER, AND WHO MOVED IT.
     *
     * Every other money authority in this shop has been auditable for a while —
     * a tax rate, a coupon, a customer's credit limit, a group's discount — and
     * the number a shop changes most often was not on the list. Sugar goes from
     * 180 to 210 and the only record of 180 was the screen it was typed over.
     *
     * ── Three prices, and deliberately not the fourth ───────────────────
     *
     * `cost` is missing on purpose. It is not a decision: it re-blends itself
     * on every delivery (weighted average, see MovingCost), so auditing it
     * would file a row per line per goods-received, none of them anybody's
     * choice, and bury the ones that are. The shop already has a truer record
     * of what it paid — the purchase order lines, with a date and a supplier
     * against each.
     *
     * ── And not on create ───────────────────────────────────────────────
     *
     * See `auditCreate` below. An item arriving with a price is not a price
     * change; a shop that opens with five thousand of them would have no trail
     * left to read.
     */
    protected function auditOnly(): array
    {
        return ['price', 'discount_price', 'wholesale_price'];
    }

    /**
     * No. A catalogue is not a sequence of decisions.
     *
     * The shop opens with thousands of items and imports a supplier's list
     * every month. "This item was created with a price" is already answered by
     * the item itself and by `created_at`; filing it would push every hand-made
     * price change off the first page of the trail, which is the one thing the
     * trail is for.
     */
    protected function auditCreate(): bool
    {
        return false;
    }

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
            'sold_out_at' => 'datetime',
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

    /**
     * Is this item eighty-sixed — the kitchen has run out for now?
     *
     * Separate from `is_active`, which is a CATALOG decision: a deactivated
     * product leaves the storefront, the reports and the menu. This is a
     * SERVICE decision, made mid-shift by whoever is cooking, and undone the
     * moment the next delivery lands.
     */
    public function isSoldOut(): bool
    {
        return $this->sold_out_at !== null;
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

    /**
     * A schedule-controlled drug is prescription-only. Always.
     *
     * `drug_schedule` and `requires_prescription` were two free-standing fields
     * on the same form, and nothing tied them together — so a medicine could be
     * marked Schedule G with the prescription flag left off, and the two fences
     * built on those fields then disagreed about the same product:
     *
     *   the till   refused it — PRESCRIPTION_REQUIRED, on `drug_schedule`
     *   an order   took it — OrderService only ever read `requires_prescription`
     *
     * A shopkeeper taking that order on the telephone dispensed a controlled
     * drug with no prescription recorded and no line in the register a regulator
     * asks to see.
     *
     * Fixed in the MODEL rather than in the form, because there are four writers
     * — the create action, the update action, the CSV importer and the seeders —
     * and a rule enforced in three of them is the bug this one came from.
     */
    protected static function booted(): void
    {
        static::saving(function (self $product): void {
            if (filled($product->drug_schedule)) {
                $product->requires_prescription = true;
            }
        });
    }

    public function batches(): HasMany
    {
        // Oldest risk first: earliest expiry, then earliest manufactured,
        // then the lots nobody dated. See ProductBatch::scopeOldestFirst.
        return $this->hasMany(ProductBatch::class)->oldestFirst();
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

    /**
     * Low across the WHOLE SHOP — never for one branch.
     *
     * The reachable answer to this question is the `?low_stock=1` filter and
     * the inventory screen, both of which do it in SQL because a shop with
     * twenty thousand products cannot load them to ask. This is the same rule
     * in PHP, kept as a test's second opinion on the variant-sum half of it.
     *
     * The trap is the branch: `InventoryController` compares against stock at
     * ONE branch, and this compares against the total. A caller that wanted the
     * branch answer would get "fine" for a product that has run out where the
     * customer is standing.
     */
    public function isLowStock(): bool
    {
        return $this->track_inventory
            && $this->low_stock_threshold !== null
            && $this->effectiveStock() <= (float) $this->low_stock_threshold;
    }
}
