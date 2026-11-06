<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AN ITEM IS LISTED AT ITS BRANCHES (v2, the owner's decision of 2026-10-18).
 *
 * A product or a category is sold at every branch — or only at the ones named.
 * `all_branches` is the first (and the default: every row that exists today
 * keeps reading exactly as it does, and a branch opened next month gets these
 * items without anything being copied); the pivot names the second.
 *
 * Each pivot row carries its tenant, so the wall between shops is a column and
 * not a join: no query can reach another shop's listing through a branch id.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->boolean('all_branches')->default(true);
        });
        Schema::table('categories', function (Blueprint $table): void {
            $table->boolean('all_branches')->default(true);
        });

        Schema::create('branch_product', function (Blueprint $table): void {
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->cascadeOnDelete();
            $table->primary(['product_id', 'branch_id']);
            $table->index(['tenant_id', 'branch_id']);
        });

        Schema::create('branch_category', function (Blueprint $table): void {
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('category_id')->constrained('categories')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->cascadeOnDelete();
            $table->primary(['category_id', 'branch_id']);
            $table->index(['tenant_id', 'branch_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('branch_category');
        Schema::dropIfExists('branch_product');
        Schema::table('categories', function (Blueprint $table): void {
            $table->dropColumn('all_branches');
        });
        Schema::table('products', function (Blueprint $table): void {
            $table->dropColumn('all_branches');
        });
    }
};
