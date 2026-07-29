<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Serialized retail: track a per-unit serial / IMEI and a warranty period on
 * physical goods (phones, electronics, appliances). A product flagged
 * `tracks_serial` prompts the cashier for one serial per unit at the counter;
 * each captured serial is snapshotted onto `sale_item_serials` with its
 * warranty window, so it can be looked up later for a warranty claim and can
 * never be sold twice while it's out on a live sale.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            // Does selling this item capture a serial/IMEI per unit?
            $table->boolean('tracks_serial')->default(false)->after('requires_prescription');
            // Default warranty length in months (copied onto each sold serial;
            // the cashier may override per sale). Null = no warranty by default.
            $table->unsignedSmallInteger('warranty_months')->nullable()->after('tracks_serial');
        });

        Schema::create('sale_item_serials', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('sale_id');
            $table->uuid('sale_item_id');
            $table->uuid('product_id');
            $table->uuid('variant_id')->nullable();
            // Snapshot so a deleted/renamed product still reads on a warranty card.
            $table->string('product_name');
            // The IMEI / serial as entered at the counter.
            $table->string('serial');
            $table->unsignedSmallInteger('warranty_months')->nullable();
            $table->date('warranty_expires_at')->nullable();
            $table->timestamp('sold_at');
            $table->timestamps();

            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('sale_id')->references('id')->on('sales')->cascadeOnDelete();
            $table->foreign('sale_item_id')->references('id')->on('sale_items')->cascadeOnDelete();
            // Fast warranty lookup + the "already sold?" guard both key on this.
            $table->index(['tenant_id', 'serial']);
            $table->index('sale_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_item_serials');
        Schema::table('products', function (Blueprint $table): void {
            $table->dropColumn(['tracks_serial', 'warranty_months']);
        });
    }
};
