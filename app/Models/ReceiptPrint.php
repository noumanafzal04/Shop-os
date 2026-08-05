<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One receipt handed over the counter (see the receipt_prints migration).
 *
 * A row exists per PRINT, not per sale — that is the whole point. The second
 * copy of a receipt is the interesting one.
 */
class ReceiptPrint extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    /** The first receipt off a sale. */
    public const ORIGINAL = 'original';

    /** Any copy after the first — always marked on its face. */
    public const REPRINT = 'reprint';

    /** Same sale, prices suppressed. */
    public const GIFT = 'gift';

    public const KINDS = [self::ORIGINAL, self::REPRINT, self::GIFT];

    /** The client asked for the receipt but has not reported an outcome yet. */
    public const QUEUED = 'queued';

    /** The print job was handed to a device. Not a promise that paper came out. */
    public const PRINTED = 'printed';

    /** The client came back and said it did not go — this feeds the reprint tray. */
    public const FAILED = 'failed';

    public const STATUSES = [self::QUEUED, self::PRINTED, self::FAILED];

    protected function casts(): array
    {
        return [
            'copy_no' => 'integer',
            'printed_at' => 'datetime',
        ];
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function register(): BelongsTo
    {
        return $this->belongsTo(Register::class);
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(HardwareDevice::class, 'device_id');
    }

    /**
     * The copy number this sale's NEXT receipt gets.
     *
     * Counts every attempt, including failed ones: a receipt that jammed
     * halfway may well have reached the customer, so the copy after it is
     * still a copy. Erring the other way would let a cashier launder a reprint
     * by reporting the original as failed.
     */
    public static function nextCopyNo(string $saleId): int
    {
        return static::query()->where('sale_id', $saleId)->count() + 1;
    }
}
