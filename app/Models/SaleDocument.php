<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use App\Support\ShopDay;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * A quotation or a layaway — the promise a retailer makes before the sale
 * exists. See the create_sale_documents migration for why they share a table.
 *
 * Everything money-shaped here is FROZEN at creation. That freeze is the whole
 * product: a quotation the shop re-prices is not a quotation, and a layaway
 * whose total moves is one the customer can never finish saving for.
 */
class SaleDocument extends BaseModel
{
    use Auditable, BelongsToTenant;

    public const KIND_QUOTATION = 'quotation';

    public const KIND_LAYAWAY = 'layaway';

    /**
     * The car is in the bay and there is no bill yet.
     *
     * A third kind rather than a table of its own, because a job card does
     * exactly what the other two do — accumulate priced lines, take an advance,
     * become a sale — and `ConvertSaleDocumentAction` is the piece nobody
     * should write twice.
     */
    public const KIND_JOB_CARD = 'job_card';

    public const KINDS = [self::KIND_QUOTATION, self::KIND_LAYAWAY, self::KIND_JOB_CARD];

    /**
     * Where the CAR is, as against where the paperwork is.
     *
     * `status` below answers "is this document still live". This answers the
     * question a workshop is actually asked twenty times a day: is it ready?
     * The two are independent — a job card can be `ready` and still `open`
     * until somebody pays — and folding them would either lose the bay board or
     * invent statuses like `open_ready`, which is how a status column stops
     * being readable.
     */
    public const WORK_RECEIVED = 'received';

    public const WORK_IN_PROGRESS = 'in_progress';

    public const WORK_READY = 'ready';

    public const WORK_STATUSES = [self::WORK_RECEIVED, self::WORK_IN_PROGRESS, self::WORK_READY];

    public const STATUS_OPEN = 'open';

    public const STATUS_CONVERTED = 'converted';

    public const STATUS_CANCELLED = 'cancelled';

    /** Tenders a customer can hand over as an advance. Never `credit`. */
    public const DEPOSIT_METHODS = ['cash', 'card', 'bank_transfer', 'wallet', 'other'];

    /** Numbering: QUO-000001 / LAY-000001, per tenant, gap-free. */
    public const PREFIXES = [
        self::KIND_QUOTATION => 'QUO',
        self::KIND_LAYAWAY => 'LAY',
        self::KIND_JOB_CARD => 'JOB',
    ];

    protected function casts(): array
    {
        return [
            'subtotal' => 'decimal:2',
            'discount' => 'decimal:2',
            'tax' => 'decimal:2',
            'tax_inclusive' => 'boolean',
            'total' => 'decimal:2',
            'deposit_paid' => 'decimal:2',
            'refunded_amount' => 'decimal:2',
            'forfeited_amount' => 'decimal:2',
            'stock_reserved' => 'boolean',
            'expires_at' => 'date',
            // When the customer was told to come back. A workshop's whole
            // relationship with its customers runs on this one promise.
            'promised_at' => 'datetime',
            'odometer_in' => 'integer',
            'converted_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(SaleDocumentItem::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(SaleDocumentPayment::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /** The quotation these goods were held from (B65) — null for one written fresh. */
    public function source(): BelongsTo
    {
        return $this->belongsTo(self::class, 'source_document_id');
    }

    /** The advance this quotation became (B65), once it became one. */
    public function heldAs(): HasOne
    {
        return $this->hasOne(self::class, 'source_document_id');
    }

    public function isQuotation(): bool
    {
        return $this->kind === self::KIND_QUOTATION;
    }

    /**
     * Which car this job is on.
     *
     * The reason a workshop's records are worth keeping: a year later somebody
     * asks what was done to this registration, and without it the answer is a
     * customer's name and a guess.
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(CustomerVehicle::class, 'vehicle_id');
    }

    public function isJobCard(): bool
    {
        return $this->kind === self::KIND_JOB_CARD;
    }

    public function isLayaway(): bool
    {
        return $this->kind === self::KIND_LAYAWAY;
    }

    public function isOpen(): bool
    {
        return $this->status === self::STATUS_OPEN;
    }

    /** An open advance nobody has paid into for this long is the one to phone (L17). */
    public const QUIET_DAYS = 30;

    /**
     * Paid in full and still in the back room — the customer can take it.
     *
     * The list showed these mixed in with every other open advance (L17); it
     * is the one row the counter should act on today.
     */
    public function scopePaidUp(Builder $query): void
    {
        $query->where('status', self::STATUS_OPEN)
            ->where('total', '>', 0)
            ->whereColumn('deposit_paid', '>=', 'total');
    }

    /**
     * Open, not paid up, and nothing paid in since `$since` — counted from when
     * it was made when nothing has been paid at all.
     */
    public function scopeQuiet(Builder $query, CarbonInterface $since): void
    {
        $query->where('status', self::STATUS_OPEN)
            ->whereColumn('deposit_paid', '<', 'total')
            ->where('created_at', '<', $since)
            ->whereDoesntHave('payments', fn (Builder $q) => $q->where('paid_at', '>=', $since));
    }

    /** The start of the shop's day QUIET_DAYS ago — "not paid in 30 days" counts whole days. */
    public static function quietSince(): CarbonInterface
    {
        return ShopDay::startOf(CarbonImmutable::parse(ShopDay::calendarToday())->subDays(self::QUIET_DAYS)->toDateString());
    }

    /**
     * What the customer still owes before they can take the goods.
     *
     * Nothing, once billed: the rest was taken at the handover, on the sale
     * (B25 — the page went on saying "Balance due 2,490" after it was paid).
     */
    public function balance(): float
    {
        if ($this->status === self::STATUS_CONVERTED) {
            return 0.0;
        }

        return round((float) $this->total - (float) $this->deposit_paid, 2);
    }

    /**
     * Lapsed is DERIVED, never stored. A quote that ran out on Sunday must not
     * depend on a cron having woken up, and a stored 'expired' status would
     * quietly become wrong the moment someone extended the date.
     *
     * For a layaway this reads "past the collect-by date" — overdue, not void.
     * The goods are still the customer's; nobody's money evaporates on a timer.
     */
    public function hasLapsed(): bool
    {
        return $this->isOpen()
            && $this->expires_at !== null
            // Past the date on the shop's wall — the same "today" the lapsed
            // list filters on, so a document is never lapsed on the list and
            // live on its own page.
            && $this->expires_at->toDateString() < ShopDay::calendarToday();
    }
}
