<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A configured shop peripheral (see the hardware_devices migration). Pure
 * configuration — the POS's IPrinter/IScanner layer reads these rows to decide
 * what device to reach and over which transport.
 */
class HardwareDevice extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    /** The peripheral kinds a shop can register. */
    public const TYPES = ['receipt_printer', 'label_printer', 'barcode_scanner', 'cash_drawer', 'customer_display'];

    /** Transports the POS abstraction knows how to reach a device over. */
    public const CONNECTIONS = ['browser', 'serial', 'usb', 'bluetooth', 'lan', 'wifi', 'native'];

    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
            'is_active' => 'boolean',
            'settings' => 'array',
        ];
    }

    /** The lane this device is wired to — null means shop-wide (shared). */
    public function register(): BelongsTo
    {
        return $this->belongsTo(Register::class);
    }

    /**
     * The devices a given terminal should reach, keyed by type.
     *
     * A mart's lane 3 has its own printer and drawer but shares the shop's one
     * label printer, so resolution walks outward from the lane:
     *   1. this lane's default    2. any device on this lane
     *   3. the shop-wide default  4. any shop-wide device
     * Inactive devices are never returned — an unplugged printer must fall
     * through to the next candidate rather than silently swallow receipts.
     *
     * @return array<string, HardwareDevice>
     */
    public static function resolveForRegister(?string $registerId): array
    {
        $devices = static::query()->where('is_active', true)->get();
        $resolved = [];

        foreach (static::TYPES as $type) {
            $candidates = $devices->where('type', $type);

            $pick = null;
            if ($registerId !== null) {
                $mine = $candidates->where('register_id', $registerId);
                $pick = $mine->firstWhere('is_default', true) ?? $mine->first();
            }
            if ($pick === null) {
                $shared = $candidates->whereNull('register_id');
                $pick = $shared->firstWhere('is_default', true) ?? $shared->first();
            }

            if ($pick !== null) {
                $resolved[$type] = $pick;
            }
        }

        return $resolved;
    }
}
