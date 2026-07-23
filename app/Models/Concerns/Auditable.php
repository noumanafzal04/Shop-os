<?php

namespace App\Models\Concerns;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;

/**
 * Records create/update/delete of sensitive models to an append-only trail —
 * capturing the acting user, tenant, and exactly which fields changed.
 *
 * Sensitive/secret fields are never written to the log.
 */
trait Auditable
{
    /** @var string[] never recorded in audit values */
    protected array $auditExclude = ['password', 'remember_token', 'code_hash', 'updated_at', 'created_at'];

    public static function bootAuditable(): void
    {
        static::created(fn (Model $m) => $m->writeAudit('created', null, $m->auditAttributes($m->getAttributes())));

        static::updated(function (Model $m): void {
            $changes = $m->getChanges();
            unset($changes['updated_at']);
            if ($changes === []) {
                return;
            }
            $old = array_intersect_key($m->getOriginal(), $changes);
            $m->writeAudit('updated', $m->auditAttributes($old), $m->auditAttributes($changes));
        });

        static::deleted(fn (Model $m) => $m->writeAudit('deleted', $m->auditAttributes($m->getOriginal()), null));
    }

    protected function auditAttributes(array $attributes): array
    {
        return array_diff_key($attributes, array_flip($this->auditExclude));
    }

    protected function writeAudit(string $event, ?array $old, ?array $new): void
    {
        AuditLog::query()->create([
            'user_id' => auth()->id(),
            'tenant_id' => $this->getAttribute('tenant_id') ?? app(\App\Support\TenantContext::class)->id(),
            'event' => $event,
            'auditable_type' => static::class,
            'auditable_id' => $this->getKey(),
            'old_values' => $old,
            'new_values' => $new,
            'ip_address' => request()?->ip(),
        ]);
    }
}
