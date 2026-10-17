<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AN OFFLINE SALE THE SHOP REFUSED, KEPT WHERE THE OWNER CAN SEE IT (B49).
 *
 * A sale rung on a till with no line, then refused when the line came back —
 * an item deleted since, a discount over the ceiling — left the money in the
 * drawer against no sale at all, and the only record of it was a row in that
 * one tablet's own storage. The owner never heard of it, and the till could
 * neither ring it again nor clear it.
 *
 * Written by the sync the moment it refuses (so the owner hears whatever the
 * till does next), and settled from the till: rung again as a real sale, or
 * dealt with in some other way, with who and why.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('offline_refusals', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            // The till's operation id — the same key the sale would have had.
            $table->uuid('op');
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('pos_device_id')->nullable()->constrained('pos_devices')->nullOnDelete();
            $table->string('offline_number', 64)->nullable();
            $table->timestamp('sold_at')->nullable();
            $table->foreignUuid('rung_by')->nullable()->constrained('users')->nullOnDelete();
            // What the till said it came to; the money sitting in the drawer.
            $table->decimal('till_total', 14, 2)->nullable();
            $table->text('reason');
            $table->string('code', 64)->nullable();
            $table->json('payload')->nullable();
            $table->timestamp('refused_at');
            // null while owed to a person; rung_again | dealt_with | recorded.
            $table->string('settled_as', 20)->nullable();
            $table->string('settled_note', 255)->nullable();
            $table->foreignUuid('settled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('settled_at')->nullable();
            // The sale it became — rung again, or recorded after all.
            $table->foreignUuid('sale_id')->nullable()->constrained('sales')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'op']);
            $table->index(['tenant_id', 'settled_as']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('offline_refusals');
    }
};
