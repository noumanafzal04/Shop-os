<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('code')->unique();
            $table->text('description')->nullable();
            $table->decimal('price', 12, 2)->default(0);
            $table->unsignedTinyInteger('billing_period_months')->default(1);
            // Core business rule: Expense Manager is always included;
            // Online Shop (marketplace, orders, delivery, reviews) is the optional add-on.
            $table->boolean('online_shop_enabled')->default(false);
            $table->unsignedSmallInteger('grace_period_days')->default(7);
            $table->json('features')->nullable();

            // Plan limits — the baseline ceilings this plan grants. NULL means
            // UNLIMITED for that resource. A plan is a shared baseline; a single
            // tenant can be "extended" past these via tenants.limit_overrides
            // without minting a new plan. Enforced against live usage.
            $table->unsignedInteger('max_products')->nullable();
            $table->unsignedSmallInteger('max_branches')->nullable();
            $table->unsignedSmallInteger('max_staff')->nullable();
            $table->unsignedInteger('max_storage_mb')->nullable();
            $table->unsignedInteger('max_orders_month')->nullable();

            $table->boolean('is_active')->default(true)->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plans');
    }
};
