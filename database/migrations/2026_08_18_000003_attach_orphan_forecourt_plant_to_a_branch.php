<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Give every tank and pump the branch it always stood at.
 *
 * `branch_id` was nullable and the panel's setup form never sent one, so
 * equipment configured through the UI was stored with no branch. Opening a
 * forecourt shift resolves a missing branch to Main and then looks for tanks
 * AT Main — which matched nothing — so the station was told "set up at least
 * one tank and one nozzle before running a forecourt shift" immediately after
 * doing exactly that, with no way out of the loop.
 *
 * The code no longer creates these rows. This is for the ones already out
 * there: without it, a station that set its forecourt up before today stays
 * broken after the fix ships, which is the worse half of the bug.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['fuel_tanks', 'fuel_pumps'] as $table) {
            DB::table($table)
                ->whereNull('branch_id')
                ->update([
                    'branch_id' => DB::raw(
                        '(select id from branches
                            where branches.tenant_id = '.$table.'.tenant_id
                              and branches.is_default = 1
                            limit 1)'
                    ),
                ]);
        }
    }

    public function down(): void
    {
        // Deliberately empty. Putting the nulls back would re-break every
        // forecourt this repaired, and nothing depends on them being null.
    }
};
