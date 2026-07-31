<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Customer groups — tiered pricing for a segment of customers (e.g. "Wholesale
 * / Trade", "Staff", "VIP"). A group can:
 *   - pin a default PRICE LEVEL (retail | wholesale) so a trade customer is
 *     rung at wholesale rates automatically (a line may still override), and
 *   - carry an automatic members' DISCOUNT percent applied at checkout.
 * The server resolves the linked customer's group and applies both — never
 * trusting a client-sent price. Stamped on the sale for attribution.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_groups', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            $table->string('price_level')->default('retail');      // retail | wholesale
            $table->decimal('discount_percent', 5, 2)->nullable(); // auto members' discount
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'is_active']);
        });

        Schema::table('customers', function (Blueprint $table): void {
            $table->foreignUuid('customer_group_id')->nullable()->after('tenant_id')
                ->constrained('customer_groups')->nullOnDelete();
        });

        Schema::table('sales', function (Blueprint $table): void {
            $table->uuid('customer_group_id')->nullable()->after('customer_id');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropColumn('customer_group_id');
        });
        Schema::table('customers', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('customer_group_id');
        });
        Schema::dropIfExists('customer_groups');
    }
};
