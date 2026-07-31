<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tax groups + inclusive tax.
 *
 * A `tax_group` is a named, reusable rate ("GST 17%", "Reduced 5%",
 * "Zero-rated 0%") a product can point at instead of carrying a raw percent —
 * change the group once and every product on it re-rates. Effective rate on a
 * sale line is: the product's tax group, else its own tax_rate, else the shop
 * default_tax_rate.
 *
 * `sales.tax_inclusive` records whether the sale was rung in inclusive mode
 * (price already contains tax) so receipts and returns treat the tax portion
 * consistently — a return of an inclusive sale must not add tax back on top.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tax_groups', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            $table->decimal('rate', 5, 2);          // percent, e.g. 17.00 (0 = zero-rated)
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'is_active']);
        });

        Schema::table('products', function (Blueprint $table): void {
            $table->foreignUuid('tax_group_id')->nullable()->after('tax_rate')
                ->constrained('tax_groups')->nullOnDelete();
        });

        Schema::table('sales', function (Blueprint $table): void {
            $table->boolean('tax_inclusive')->default(false)->after('tax');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropColumn('tax_inclusive');
        });
        Schema::table('products', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('tax_group_id');
        });
        Schema::dropIfExists('tax_groups');
    }
};
