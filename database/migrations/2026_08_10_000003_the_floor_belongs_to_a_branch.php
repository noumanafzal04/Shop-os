<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A restaurant with two sites had one floor and one kitchen queue.
 *
 * Every money table carries a branch. `dining_tables`, `restaurant_tickets` and
 * `kitchen_tickets` carried none, so the Gulberg pass showed DHA's fired
 * tickets, cooks worked another kitchen's orders, and two waiters at different
 * addresses fought over the same "T1". The takings report per branch was right
 * the whole time, which is what made it look like a display glitch rather than
 * a missing dimension.
 *
 * Backfilled to the tenant's default branch rather than left NULL. Unlike a
 * supplier payment — where nothing recorded which till the cash left, so a
 * guess would be a lie — a single-site restaurant's floor IS its only branch,
 * and that is every restaurant using this today. A NULL floor would vanish from
 * the branch-scoped screens these columns exist to feed.
 *
 * A ticket takes its branch from the TABLE it was opened at where there is one,
 * and a KOT from its ticket: the same rule refunds follow, where the row
 * belongs to the trade it came from rather than to whoever touched it last.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['dining_tables', 'restaurant_tickets', 'kitchen_tickets'] as $table) {
            Schema::table($table, function (Blueprint $t): void {
                $t->foreignUuid('branch_id')->nullable()->after('tenant_id')
                    ->constrained('branches')->nullOnDelete();
            });
        }

        // Every existing floor is its shop's only floor.
        foreach (['dining_tables', 'restaurant_tickets', 'kitchen_tickets'] as $table) {
            DB::table($table)->whereNull('branch_id')->update([
                'branch_id' => DB::raw(
                    "(select id from branches where branches.tenant_id = {$table}.tenant_id"
                    .' and branches.is_default = 1 limit 1)',
                ),
            ]);
        }

        // A tab that was opened at a table belongs where that table stands,
        // whatever the shop's default is.
        DB::table('restaurant_tickets')->whereNotNull('dining_table_id')->update([
            'branch_id' => DB::raw(
                '(select branch_id from dining_tables where dining_tables.id = restaurant_tickets.dining_table_id)',
            ),
        ]);

        DB::table('kitchen_tickets')->update([
            'branch_id' => DB::raw(
                '(select branch_id from restaurant_tickets where restaurant_tickets.id = kitchen_tickets.ticket_id)',
            ),
        ]);

        Schema::table('dining_tables', function (Blueprint $t): void {
            $t->index(['tenant_id', 'branch_id', 'is_active']);
        });
        Schema::table('restaurant_tickets', function (Blueprint $t): void {
            $t->index(['tenant_id', 'branch_id', 'status']);
        });
        Schema::table('kitchen_tickets', function (Blueprint $t): void {
            $t->index(['tenant_id', 'branch_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::table('dining_tables', function (Blueprint $t): void {
            $t->dropIndex(['tenant_id', 'branch_id', 'is_active']);
            $t->dropConstrainedForeignId('branch_id');
        });

        foreach (['restaurant_tickets', 'kitchen_tickets'] as $table) {
            Schema::table($table, function (Blueprint $t): void {
                $t->dropIndex(['tenant_id', 'branch_id', 'status']);
                $t->dropConstrainedForeignId('branch_id');
            });
        }
    }
};
