<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/**
 * One changed platform setting. Read through `PlatformSettings`, never
 * directly — the defaults live there and a bare row is only half the answer.
 *
 * ── In the audit trail ───────────────────────────────────────────────
 *
 * It was not. The add-on price list on a development database went from one
 * price to none and back to two in half an hour, and "who emptied it, and
 * when?" could not be read off anything: a shop's every module switch is in
 * the trail, and the list that sets what every shop is BILLED for a module
 * was not. Nor was the commission rate — the platform's cut of every online
 * order — nor whether commission is charged at all.
 *
 * A setting's row is keyed by its name, so that name is the row's id in the
 * trail: "PlatformSetting · module_addon_prices" is what was changed, with
 * the map before and the map after.
 */
class PlatformSetting extends Model
{
    use Auditable {
        auditAttributes as protected everyAuditAttribute;
    }

    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['value' => 'json'];
    }

    /**
     * What was set, and nothing else: WHO set it is the trail's own column,
     * and `updated_by` beside it is the same person named twice — once as a
     * name, once as an id nobody can read.
     */
    protected function auditAttributes(array $attributes): array
    {
        unset($attributes['updated_by']);

        /*
         * THE VALUE AS IT IS, NOT AS ITS JSON TEXT.
         *
         * The column is JSON whatever it holds, and what was just written
         * arrives here raw: a switch as the four letters `true`, a rate as
         * "3.5", a name with its own quotation marks round it. The trait
         * opens up maps for the same reason and leaves scalars alone, which
         * is right for every other model — theirs are plain columns. Here it
         * filed "commission: 'true'" on one side of an arrow and a real
         * `false` on the other.
         *
         * A value that has already been cast and is not JSON text ("dark")
         * does not decode, and is left exactly as it is.
         */
        if (is_string($attributes['value'] ?? null)) {
            $decoded = json_decode($attributes['value'], true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $attributes['value'] = $decoded;
            }
        }

        return $this->everyAuditAttribute($attributes);
    }
}
