<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Loyalty & rewards: customers earn points on completed sales and redeem them
 * as a discount at the counter. Modelled exactly like the khata (credit)
 * ledger — a running `loyalty_points` balance on the customer plus an
 * append-only `loyalty_entries` ledger, so returns/cancels reverse
 * symmetrically and a statement never has to be recomputed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table): void {
            $table->integer('loyalty_points')->default(0)->after('credit_limit');
        });

        Schema::table('sales', function (Blueprint $table): void {
            // What this sale earned / spent — snapshotted so a later return can
            // claw back exactly the right amount.
            $table->integer('points_earned')->default(0)->after('total');
            $table->integer('points_redeemed')->default(0)->after('points_earned');
        });

        Schema::create('loyalty_entries', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('customer_id');
            $table->uuid('sale_id')->nullable();
            // earn | redeem | reverse_earn | reverse_redeem
            $table->string('type');
            $table->integer('points');          // always positive; `type` gives direction
            $table->integer('balance_after');
            $table->string('note')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();

            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('customer_id')->references('id')->on('customers')->cascadeOnDelete();
            $table->foreign('sale_id')->references('id')->on('sales')->nullOnDelete();
            $table->index(['customer_id', 'sale_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('loyalty_entries');
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropColumn(['points_earned', 'points_redeemed']);
        });
        Schema::table('customers', function (Blueprint $table): void {
            $table->dropColumn('loyalty_points');
        });
    }
};
