<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Somebody brought it back.
 *
 * The warranty desk could already answer "is this still covered?" — and then
 * had nowhere to put the answer. A customer walks in with a battery, the
 * counter confirms it has four months left, and the shop's only record of the
 * whole transaction is what the person behind the counter remembers. So the
 * second visit starts from nothing, a repeat failure looks like a first one,
 * and there is no way to tell the supplier how many of their units came back.
 *
 * A claim is deliberately NOT a return: no money moves, no stock moves, and
 * the unit is usually gone for days. Modelling it as a sale return would have
 * put a refund on the till that never happened.
 *
 * `resolution` is null while the claim is open — that IS the open state, so a
 * counter can list what it is still holding without a status column that can
 * disagree with the resolution beside it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('warranty_claims', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            // The unit itself. Kept as a relation AND as a bare serial, because
            // a claim outlives the sale row it came from — a cancelled sale
            // must not erase the fact that the shop is holding someone's phone.
            $table->foreignUuid('sale_item_serial_id')->nullable()->constrained()->nullOnDelete();
            $table->string('serial', 120);
            $table->string('product_name');

            // What the customer said was wrong, in their words.
            $table->string('fault', 500);
            $table->string('customer_name')->nullable();
            $table->string('customer_phone', 32)->nullable();
            // Was it in warranty ON THE DAY IT CAME IN? Snapshotted, because
            // the window will have closed by the time a supplier replies, and
            // the shop's decision has to be judged on what was true then.
            $table->boolean('was_under_warranty')->default(false);
            $table->date('warranty_expires_at')->nullable();

            // null = still open. Set once, with the day it happened.
            $table->string('resolution', 20)->nullable();
            $table->string('resolution_note', 500)->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->foreignUuid('resolved_by')->nullable()->constrained('users')->nullOnDelete();

            // Filled by HasAuditFields — who booked it in, who touched it last.
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            // Every domain model here soft-deletes; a record of somebody else's
            // property is the last one that should vanish outright.
            $table->softDeletes();

            // The two questions a counter asks: "what are we holding?" and
            // "has this unit been back before?"
            $table->index(['tenant_id', 'resolution']);
            $table->index(['tenant_id', 'serial']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('warranty_claims');
    }
};
