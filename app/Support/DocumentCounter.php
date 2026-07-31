<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Gap-free, race-safe per-tenant document sequences (RET-…, and any future
 * per-tenant numbered document). Mirrors the invoice-counter mechanism: the
 * counter row is locked and incremented INSIDE the caller's transaction, so a
 * rollback rolls the increment back and two concurrent writers can never mint
 * the same number.
 *
 * Prefer this over `count() + 1`, which collides under concurrency (two writers
 * read the same count before either inserts) and skips/reuses after a delete.
 */
class DocumentCounter
{
    /**
     * Next integer in the (tenant, type) sequence. MUST be called inside a DB
     * transaction so the lock + increment are atomic with the row it numbers.
     */
    public static function next(string $tenantId, string $type): int
    {
        DB::table('document_counters')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'type' => $type,
            'next_number' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $row = DB::table('document_counters')
            ->where('tenant_id', $tenantId)
            ->where('type', $type)
            ->lockForUpdate()
            ->first();

        DB::table('document_counters')
            ->where('tenant_id', $tenantId)
            ->where('type', $type)
            ->update(['next_number' => $row->next_number + 1, 'updated_at' => now()]);

        return (int) $row->next_number;
    }

    /**
     * Formatted document number, e.g. formatted($t, 'sale_return', 'RET') →
     * "RET-000001".
     */
    public static function formatted(string $tenantId, string $type, string $prefix, int $pad = 6): string
    {
        return $prefix.'-'.str_pad((string) self::next($tenantId, $type), $pad, '0', STR_PAD_LEFT);
    }
}
