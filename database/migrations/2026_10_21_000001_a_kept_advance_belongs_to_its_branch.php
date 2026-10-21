<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Retail #10 (2026-10-21): the fee kept on a cancelled advance was booked as
 * income with no branch, so everyone pinned to a branch read their income,
 * Cashbook and profit short by it. New rows carry the advance's branch; this
 * gives the rows already written the branch of the advance they came from.
 *
 * Data only, and only rows with no branch — nothing anybody chose is changed.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('incomes')
            ->whereNull('branch_id')
            ->where('description', 'like', 'Forfeited advance · %')
            ->orderBy('id')
            ->chunkById(200, function ($rows): void {
                foreach ($rows as $row) {
                    $number = substr((string) $row->description, strlen('Forfeited advance · '));
                    $branch = DB::table('sale_documents')
                        ->where('tenant_id', $row->tenant_id)
                        ->where('number', $number)
                        ->value('branch_id');

                    if ($branch !== null) {
                        DB::table('incomes')->where('id', $row->id)->update(['branch_id' => $branch]);
                    }
                }
            });
    }

    public function down(): void
    {
        // A branch put right is not taken away again.
    }
};
