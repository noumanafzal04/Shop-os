<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

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
}
