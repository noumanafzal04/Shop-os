<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * TWO LINKS THAT ARE SEARCHED BY, AND WERE NOT INDEXED.
 *
 * An audit of the schema found twenty-one `*_id` columns with neither a
 * foreign key nor an index. That number is not the finding — a column needs
 * an index only if something searches by it — so each was looked for in a
 * `where`. Two are (docs/qa/2026-10-11-duplicate-columns-audit.md):
 *
 *   product_serials.sale_id         a sale is cancelled or returned, and the
 *                                   units it took go back on the shelf — found
 *                                   by reading every unit the shop has ever
 *                                   written down
 *
 *   expenses.recurring_expense_id   Expenses narrowed to one monthly bill, or
 *                                   to "posted from a template / not"
 *
 * Nothing on a new shop; a slow screen on one with a hundred thousand rows,
 * which is the size a phone shop's serials and a few years of expenses reach.
 *
 * Additive: no data moves, and `down()` only takes the two indexes away.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_serials', function (Blueprint $table): void {
            $table->index(['tenant_id', 'sale_id']);
        });

        Schema::table('expenses', function (Blueprint $table): void {
            $table->index(['tenant_id', 'recurring_expense_id']);
        });
    }

    public function down(): void
    {
        Schema::table('product_serials', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'sale_id']);
        });

        Schema::table('expenses', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'recurring_expense_id']);
        });
    }
};
