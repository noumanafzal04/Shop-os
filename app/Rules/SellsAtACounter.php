<?php

namespace App\Rules;

use App\Models\Branch;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A place named for something only a SHOP has — a till lane, a fuel pump, a
 * price of its own — must be a shop.
 *
 * A warehouse is a place too, and every list of places now has warehouses in
 * it. Left to `exists:branches`, a checkout lane could be opened in the
 * godown and a branch price set for a place that sells nothing: each a row
 * that looks real and can never be used, which is the kind of thing found a
 * year later by whoever is trying to work out why a lane has no shifts.
 *
 * The tenant scope applies through the model, so this also refuses another
 * business's branch — and says which of the two it was.
 */
class SellsAtACounter implements ValidationRule
{
    /** @param  string  $thing  what was being placed there, e.g. "a till", "a pump" */
    public function __construct(private readonly string $thing = 'a till') {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if ($value === null || $value === '') {
            return;
        }

        /** @var Branch|null $place */
        $place = Branch::query()->whereKey($value)->first(['id', 'name', 'kind']);

        if ($place === null) {
            $fail('That branch does not exist.');

            return;
        }

        if ($place->isWarehouse()) {
            $fail("{$place->name} is a warehouse — it holds stock and cannot have {$this->thing}. Choose a shop.");
        }
    }
}
