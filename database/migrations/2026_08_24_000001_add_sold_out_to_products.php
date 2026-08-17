<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Eighty-six the fish."
 *
 * ── The hole this fills ─────────────────────────────────────────────────
 *
 * A kitchen runs out of a dish halfway through service. Until now there was
 * nothing a shop could do about it, and the reason is written into the
 * inventory service on purpose:
 *
 *     "Recipe/BOM ingredient depletion passes allow_negative: a dish is made
 *      to order, so an under-recorded ingredient must never block the sale."
 *
 * That is the right call — refusing to settle a dine-in tab for food already
 * eaten would be worse than a negative stock figure. But it means a dish can
 * NEVER be out of stock, so the till will happily keep selling a fish that
 * does not exist, all evening, to as many tables as ask for it.
 *
 * The only workaround was deactivating the product, which is a catalog edit:
 * it hides the item from the storefront too, it records no reason and no time,
 * and nobody re-activates twenty dishes at eleven at night.
 *
 * ── Why a timestamp and not a boolean ───────────────────────────────────
 *
 * The failure mode of this feature is not switching it on — it is **forgetting
 * to switch it off**. A dish 86'd on Tuesday and still off on Friday is lost
 * revenue nobody is looking for, and a boolean cannot tell you that has
 * happened. `sold_out_at` lets the screen say "off since Tuesday", which is
 * the sentence that gets it turned back on.
 *
 * ── And why it does NOT clear itself overnight ──────────────────────────
 *
 * Tempting, because most 86s are for one service. But the two failures are not
 * equal: an item that clears itself while the kitchen still has none puts a
 * customer in front of a dish that never arrives, and an item that stays off
 * after the kitchen prepped it makes staff ask why they cannot sell it. The
 * second is visible, immediate and free to fix. The first is a complaint.
 *
 * Deliberately NOT fenced to food. A mart's samosas by the till track no stock
 * either, and "we're out of those today" is the same sentence.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->timestamp('sold_out_at')->nullable()->after('is_active');
            // Who called it. A dish that has been off for three days is a
            // conversation with somebody, and "nobody knows who" ends it.
            $table->uuid('sold_out_by')->nullable()->after('sold_out_at');

            $table->foreign('sold_out_by')->references('id')->on('users')->nullOnDelete();
            // The till asks "what is off right now" on every catalog load.
            $table->index(['tenant_id', 'sold_out_at']);
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            // Constraint, then index, then column. The order is not cosmetic:
            // SQLite blocks on the index and MySQL on the foreign key, and
            // this sequence satisfies both — the same rule the rollback audit
            // established after two migrations dropped a column an index still
            // named.
            $table->dropForeign(['sold_out_by']);
            $table->dropIndex(['tenant_id', 'sold_out_at']);
            $table->dropColumn(['sold_out_at', 'sold_out_by']);
        });
    }
};
