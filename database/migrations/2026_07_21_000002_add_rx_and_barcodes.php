<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Pharmacy: a medicine that legally needs a doctor's prescription.
        // Warned (not hard-blocked) at POS; flagged online.
        Schema::table('products', function (Blueprint $table): void {
            $table->boolean('requires_prescription')->default(false)->after('generic_name');
        });

        // Alternate barcodes (grocery/mart): one product often carries several
        // barcodes — different supplier packs, old + new labels, inner/outer.
        // The product's own `barcode` column stays the primary; these are extras.
        Schema::create('product_barcodes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->nullOnDelete();
            $table->string('barcode');
            $table->timestamps();

            // A barcode resolves to exactly one item within a shop.
            $table->unique(['tenant_id', 'barcode']);
            $table->index(['tenant_id', 'product_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_barcodes');
        Schema::table('products', function (Blueprint $table): void {
            $table->dropColumn('requires_prescription');
        });
    }
};
