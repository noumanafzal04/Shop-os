<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('coupons', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('code');                       // e.g. EID20
            $table->string('type')->default('percent');   // percent | fixed
            $table->decimal('value', 12, 2);              // 20 (%) or 500 (Rs)
            $table->decimal('min_spend', 12, 2)->nullable();
            $table->decimal('max_discount', 12, 2)->nullable(); // caps a percent coupon
            $table->unsignedInteger('usage_limit')->nullable(); // null = unlimited
            $table->unsignedInteger('used_count')->default(0);
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'code']);
        });

        // Record the applied code + discount on the transaction.
        Schema::table('sales', function (Blueprint $table) {
            $table->string('coupon_code')->nullable()->after('discount');
        });
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('discount', 12, 2)->default(0)->after('subtotal');
            $table->string('coupon_code')->nullable()->after('discount');
        });
    }

    public function down(): void
    {
        Schema::table('orders', fn (Blueprint $t) => $t->dropColumn(['discount', 'coupon_code']));
        Schema::table('sales', fn (Blueprint $t) => $t->dropColumn('coupon_code'));
        Schema::dropIfExists('coupons');
    }
};
