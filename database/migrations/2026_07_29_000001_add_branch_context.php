<?php

use App\Models\Branch;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Multi-branch Phase 4a — operating-branch context.
 *
 *  - users.branch_id   the staff member's ASSIGNED (home) branch. Owners keep
 *                      null = may operate any branch; staff are pinned to one.
 *  - sales.branch_id   the branch a sale was rung up on — so stock decrements
 *                      the right branch and returns/cancels restock it back.
 *
 * Existing sales are backfilled to each tenant's default (Main) branch, matching
 * where their stock movements already live (Phase 2 backfilled all to Main).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignUuid('branch_id')->nullable()->after('tenant_id')
                ->constrained('branches')->nullOnDelete();
        });

        Schema::table('sales', function (Blueprint $table) {
            $table->foreignUuid('branch_id')->nullable()->after('tenant_id')
                ->constrained('branches')->nullOnDelete();
            $table->index(['tenant_id', 'branch_id']);
        });

        // Backfill every existing sale to its tenant's Main branch.
        Branch::withoutTenancy()->where('is_default', true)->get(['id', 'tenant_id'])
            ->each(function (Branch $main): void {
                DB::table('sales')
                    ->where('tenant_id', $main->tenant_id)
                    ->whereNull('branch_id')
                    ->update(['branch_id' => $main->id]);
            });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'branch_id']);
            $table->dropConstrainedForeignId('branch_id');
        });
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('branch_id');
        });
    }
};
