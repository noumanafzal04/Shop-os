<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Counting the shelves.
 *
 * A shop's stock figure drifts — breakage, theft, a sale rung on the wrong
 * item, a delivery received short. Until someone counts, nobody knows by how
 * much, and the first honest answer usually arrives as a customer standing at
 * the counter with an item the system says is out of stock.
 *
 * The design turns on one thing: `expected_quantity` is a SNAPSHOT taken when
 * the sheet was drawn, and the shop keeps trading while it counts. Applying a
 * count as an absolute would erase every sale rung during it. So a count is
 * applied as the VARIANCE — a delta — and the sales in between survive.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_counts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // Stock is per-branch, so a count is too. You cannot count a shelf
            // in Gulberg from Model Town.
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('reference');                    // SC-000001, per tenant
            $table->string('status')->default('counting');  // counting|applied|cancelled
            $table->string('scope')->default('all');        // all|category
            $table->foreignUuid('category_id')->nullable()->constrained('categories')->nullOnDelete();
            // A counter shown the expected figure stops counting when they
            // reach it. Same reason the drawer close is blind.
            $table->boolean('blind')->default(true);
            $table->unsignedInteger('lines_total')->default(0);
            $table->unsignedInteger('lines_counted')->default(0);
            // Written once, at apply. A count signed off in March must read the
            // same in September, whatever has happened to the stock since.
            $table->decimal('variance_units', 14, 3)->nullable();
            $table->decimal('variance_value', 14, 2)->nullable();
            $table->text('notes')->nullable();
            $table->uuid('started_by')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->uuid('applied_by')->nullable();
            $table->timestamp('applied_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'reference']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'branch_id']);
        });

        Schema::create('stock_count_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('stock_count_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->cascadeOnDelete();
            // Snapshots: a line must still read correctly after the product is
            // renamed or deleted.
            $table->string('product_name');
            $table->string('variant_name')->nullable();
            $table->string('sku')->nullable();
            // What the system said WHEN THE SHEET WAS DRAWN. The variance is
            // measured against this, never against live stock.
            $table->decimal('expected_quantity', 12, 3);
            // NULL means "nobody counted this shelf". It does NOT mean zero —
            // reading it as zero would write off every item nobody reached.
            $table->decimal('counted_quantity', 12, 3)->nullable();
            // What the shrinkage is worth. Snapshotted: today's cost is what
            // this count was judged on.
            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->timestamp('counted_at')->nullable();
            $table->uuid('counted_by')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'stock_count_id']);
            $table->index(['stock_count_id', 'product_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_count_items');
        Schema::dropIfExists('stock_counts');
    }
};
