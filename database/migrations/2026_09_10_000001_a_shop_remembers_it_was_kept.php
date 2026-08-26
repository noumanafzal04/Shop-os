<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * WHERE THIS SHOP CAME FROM.
 *
 * Three doors lead onto this platform and until now the tenant list could not
 * tell them apart:
 *
 *   · an admin opened the shop (the only door that existed at first),
 *   · somebody is trying a demo,
 *   · somebody tried a demo, pressed "Keep this shop", and an admin said yes.
 *
 * The third one is the one worth knowing about. That shop has an owner who has
 * never spoken to anybody, is sitting in the setup wizard with a generated name
 * like "Mart Demo K7QP", and has no plan on it — the single most valuable row
 * in the table and it looked exactly like a shop opened by hand six months ago.
 *
 * ── Why a column and not a join ────────────────────────────────────────
 *
 * The fact is already recorded: an approved `shop_requests` row names the
 * tenant. But it is the wrong shape for the job it is now being asked to do —
 * this list filters and SORTS by it, and a whereExists on another table for
 * every page of a filter is a query that gets slower as the platform succeeds.
 *
 * It is also a fact about the SHOP's life, not about the request. A request
 * that is later cleaned away must not take with it the answer to "is this a
 * new owner?" — so the shop carries its own answer.
 *
 * Nullable, and null means "not converted": every shop that already exists
 * came in through one of the other two doors, and the backfill below fills in
 * the ones that did not.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            // Indexed because the admin list filters on it and sorts new
            // owners to the top — the two things it exists for.
            $table->timestamp('converted_at')->nullable()->index()->after('setup_completed');
        });

        // Shops already converted before this column existed. Without this the
        // feature would ship saying nobody has ever kept a shop, which is a
        // more convincing lie than an empty column.
        if (Schema::hasTable('shop_requests')) {
            DB::table('tenants')->orderBy('id')->chunkById(200, function ($tenants): void {
                foreach ($tenants as $tenant) {
                    $approvedAt = DB::table('shop_requests')
                        ->where('tenant_id', $tenant->id)
                        ->where('status', 'approved')
                        ->max('reviewed_at');

                    if ($approvedAt !== null) {
                        DB::table('tenants')->where('id', $tenant->id)->update(['converted_at' => $approvedAt]);
                    }
                }
            });
        }
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            $table->dropIndex(['converted_at']);
            $table->dropColumn('converted_at');
        });
    }
};
