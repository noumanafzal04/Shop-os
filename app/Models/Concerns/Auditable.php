<?php

namespace App\Models\Concerns;

use App\Models\AuditLog;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Model;

/**
 * Records create/update/delete of sensitive models to an append-only trail —
 * capturing the acting user, tenant, and exactly which fields changed.
 *
 * Sensitive/secret fields are never written to the log.
 *
 * ── Whole model, or one field ───────────────────────────────────────────
 *
 * Most models here are audited entire: a sale, a stock disposal, a banking
 * slip. Some are worth recording in ONE respect only, and auditing them
 * entire would be worse than not auditing them at all — a customer record
 * changes every time somebody corrects a phone number, and a shop that
 * imports five thousand products would bury its own trail in one afternoon.
 *
 * `$auditOnly` is that allowlist. When it is set:
 *
 *   · an UPDATE that touches none of those fields writes nothing;
 *   · a CREATE is recorded only if one of them arrives with a value, because
 *     a customer given a Rs 90,000 credit limit on day one is the same act as
 *     raising it to Rs 90,000 on day two, and the log has to hold both;
 *   · a DELETE is always recorded — losing the row is losing the field.
 */
trait Auditable
{
    /** @var string[] never recorded in audit values */
    protected array $auditExclude = ['password', 'remember_token', 'code_hash', 'pin_hash', 'updated_at', 'created_at'];

    /**
     * Record ONLY these fields, and only when one of them moves. Empty = the
     * whole model, which is the default and what most audited models want.
     *
     * A method rather than a property: PHP refuses to compose a trait whose
     * property a class redeclares with a different default, which is exactly
     * what overriding this means.
     *
     * @return string[]
     */
    protected function auditOnly(): array
    {
        return [];
    }

    public static function bootAuditable(): void
    {
        static::created(function (Model $m): void {
            $new = $m->auditAttributes($m->getAttributes());
            // A create that carries none of the watched fields is not an event
            // this model is audited FOR. Without this, every walk-in customer
            // keyed at the counter would file an audit row about a credit limit
            // nobody gave them.
            if ($m->auditOnly() !== [] && ! $m->auditWorthRecording($new)) {
                return;
            }
            $m->writeAudit('created', null, $new);
        });

        static::updated(function (Model $m): void {
            $changes = $m->getChanges();
            unset($changes['updated_at']);
            if ($changes === []) {
                return;
            }

            $recorded = $m->auditAttributes($changes);

            // An allowlisted model that moved none of its watched fields has
            // not had the kind of event it is audited FOR. Everything else
            // still files a row even when every changed field is excluded —
            // a password change records THAT it happened with no values
            // beside it, and losing that line would be losing the signal.
            if ($recorded === [] && $m->auditOnly() !== []) {
                return;
            }

            $old = array_intersect_key($m->auditAttributes($m->getOriginal()), $recorded);
            $m->writeAudit('updated', $old, $recorded);
        });

        // Always recorded, allowlist or not: losing the row loses the field.
        static::deleted(fn (Model $m) => $m->writeAudit('deleted', $m->auditAttributes($m->getOriginal()), null));
    }

    protected function auditAttributes(array $attributes): array
    {
        $kept = array_diff_key($attributes, array_flip($this->auditExclude));

        $only = $this->auditOnly();

        return $only === [] ? $kept : array_intersect_key($kept, array_flip($only));
    }

    /**
     * Is there anything in here worth a row?
     *
     * Zero and null both mean "no authority was granted", and a log full of
     * "credit limit: null" is a log nobody reads to the bottom of.
     */
    protected function auditWorthRecording(array $values): bool
    {
        foreach ($values as $value) {
            if ($value !== null && $value !== '' && $value !== 0 && $value !== '0' && (float) $value !== 0.0) {
                return true;
            }
        }

        return false;
    }

    protected function writeAudit(string $event, ?array $old, ?array $new): void
    {
        AuditLog::query()->create([
            'user_id' => auth()->id(),
            'tenant_id' => $this->getAttribute('tenant_id') ?? app(TenantContext::class)->id(),
            'event' => $event,
            'auditable_type' => static::class,
            'auditable_id' => $this->getKey(),
            'old_values' => $old,
            'new_values' => $new,
            'ip_address' => request()?->ip(),
        ]);
    }
}
