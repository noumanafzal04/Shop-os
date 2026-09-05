<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CASH IN HAND.
 *
 * A rider who delivers a cash order is holding the shop's money until they
 * hand it over. Nothing recorded that today, because until now the shop's
 * rider was somebody standing in the shop.
 *
 * What a rider is owed and what they are holding are DERIVED, never stored:
 * the orders themselves say it (`total` collected on a cod order,
 * `delivery_fee` earned on any delivered one). A stored balance is a second
 * copy of a number the orders already answer, and the two drift the first time
 * an order is refunded.
 *
 * This table records only the EVENT the orders cannot: the shop counted the
 * money and took it. Each settled order points back at the row that cleared
 * it, so "still owed" is `delivered && rider_settlement_id is null` — one
 * query, no running total to keep true.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_settlements', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            // Tenant-scoped: this is one shop's money, and a rider carrying for
            // three shops settles with each of them separately.
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('rider_profile_id')->nullable()->constrained('rider_profiles')->nullOnDelete();
            // A phone-call rider has no profile; the shop still settles with
            // them, and this is who they were.
            $table->foreignUuid('rider_id')->nullable()->constrained('riders')->nullOnDelete();

            $table->decimal('cash_collected', 12, 2)->default(0);
            $table->decimal('rider_earned', 12, 2)->default(0);
            // What actually changed hands: cash held minus fees kept. Recorded
            // rather than recomputed, because the shop may round or hold a
            // deduction back and the receipt has to say what was really paid.
            $table->decimal('amount_paid', 12, 2)->default(0);
            $table->unsignedInteger('orders_count')->default(0);

            $table->string('note', 500)->nullable();
            $table->foreignUuid('settled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('settled_at');
            $table->timestamps();

            $table->index(['tenant_id', 'rider_profile_id', 'settled_at']);
        });

        Schema::table('orders', function (Blueprint $table): void {
            $table->foreign('rider_settlement_id')->references('id')->on('rider_settlements')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropForeign(['rider_settlement_id']);
        });
        Schema::dropIfExists('rider_settlements');
    }
};
