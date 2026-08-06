<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A vehicle the shop works on.
 *
 * The counter's real key. Ask a tyre shop about a regular and they answer with
 * a plate, not a person — LEA-1234, the white Corolla, 195/65 R15, fitted a set
 * in March. Remembering only the phone number means measuring the tyre again
 * every visit and having nothing for a warranty claim to hang off.
 *
 * A sale points at the vehicle directly rather than through the customer, so a
 * fleet running ten vans on one account can still answer "what did we do to
 * THIS van".
 */
class CustomerVehicle extends BaseModel
{
    use BelongsToTenant;

    protected $table = 'customer_vehicles';

    protected function casts(): array
    {
        return [
            'year' => 'integer',
            'odometer' => 'integer',
            'odometer_at' => 'date',
            'is_active' => 'boolean',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function sales(): HasMany
    {
        return $this->hasMany(Sale::class, 'vehicle_id');
    }

    /**
     * Plates are written a dozen ways — "lea 1234", "LEA-1234", "LEA1234" are
     * one car. Normalising on the way in is what makes the lookup find it, and
     * what stops the same vehicle being created three times.
     */
    public static function normalizeRegistration(string $registration): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $registration) ?? '');
    }

    /** "Toyota Corolla GLi (2018)" — what the counter reads back. */
    public function describe(): string
    {
        $parts = array_filter([$this->make, $this->model]);
        $name = $parts === [] ? 'Vehicle' : implode(' ', $parts);

        return $this->year !== null ? "{$name} ({$this->year})" : $name;
    }

    /**
     * The last reading, moved forward only. An odometer that goes backwards is
     * a typo or a replaced cluster; either way the higher number is the one a
     * service interval should be counted from, and silently accepting a lower
     * one would reset every reminder the shop has.
     */
    public function recordOdometer(?int $reading): void
    {
        if ($reading === null || ($this->odometer !== null && $reading <= $this->odometer)) {
            return;
        }

        $this->forceFill(['odometer' => $reading, 'odometer_at' => now()->toDateString()])->save();
    }
}
