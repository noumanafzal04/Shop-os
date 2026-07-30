<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Promotions — automatic, scheduled discounts the POS applies without a code
 * (unlike coupons). A promotion targets the whole order, a category, or a set
 * of products, at a percent or fixed amount, and is live only within its
 * schedule: an optional date range (flash sale) + optional days-of-week and
 * time window (happy hour). The server evaluates them authoritatively at
 * checkout and stamps the winning promotion + its discount on the sale.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('promotions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            $table->string('type')->default('percent');    // percent | fixed
            $table->decimal('value', 12, 2);                // 20 (%) or 500 (Rs)
            $table->string('scope')->default('order');      // order | category | product
            $table->foreignUuid('category_id')->nullable()->constrained('categories')->nullOnDelete();
            $table->json('product_ids')->nullable();        // scope = product
            $table->decimal('min_spend', 12, 2)->nullable();   // order scope
            $table->decimal('min_qty', 12, 3)->nullable();     // category/product scope
            $table->decimal('max_discount', 12, 2)->nullable();
            // Flash-sale window (dates, inclusive; null = open-ended).
            $table->date('starts_on')->nullable();
            $table->date('ends_on')->nullable();
            // Happy hour: days of week (0=Sun..6=Sat; null = every day) + a
            // daily time window (null = all day; may wrap midnight).
            $table->json('days_of_week')->nullable();
            $table->time('start_time')->nullable();
            $table->time('end_time')->nullable();
            $table->integer('priority')->default(0);        // tie-break: higher wins
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'is_active']);
        });

        // Attribution on the sale — which promo fired and for how much.
        Schema::table('sales', function (Blueprint $table): void {
            $table->uuid('promotion_id')->nullable()->after('coupon_code');
            $table->string('promo_name')->nullable()->after('promotion_id');
            $table->decimal('promo_discount', 12, 2)->default(0)->after('promo_name');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropColumn(['promotion_id', 'promo_name', 'promo_discount']);
        });
        Schema::dropIfExists('promotions');
    }
};
