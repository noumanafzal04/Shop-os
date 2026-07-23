<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Catalog categories — UNLIMITED nesting (self-referential parent_id),
        // per tenant. sort_order drives display order; is_active = visibility.
        Schema::create('categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('parent_id')->nullable()->constrained('categories')->nullOnDelete();
            $table->string('name');
            $table->string('image_path')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'parent_id']);
            $table->index(['tenant_id', 'name']);
        });

        // Collections — FoodPanda-style display sections (Popular, Deals, New
        // Arrival…). Cross-cut categories; owners attach any items.
        Schema::create('collections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            $table->string('slug');
            $table->text('description')->nullable();
            $table->string('image_path')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->boolean('visible_in_marketplace')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'slug']);
            $table->index(['tenant_id', 'sort_order']);
        });

        // Expense categories — seeded from business-type template, editable.
        Schema::create('expense_categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            $table->boolean('is_default')->default(false); // came from template
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'name']);
        });

        // Items — the common model for PRODUCTS and SERVICES.
        Schema::create('products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('category_id')->nullable()->constrained('categories')->nullOnDelete();
            $table->string('type')->default('product'); // coarse: product | service
            $table->string('item_type')->default('physical_product'); // physical_product|food_item|medicine|service
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('sku')->nullable();
            $table->string('barcode')->nullable();  // Code128/EAN/QR payload
            $table->string('brand')->nullable();
            // Generic/salt/composition (pharmacy): the active-ingredient name a
            // customer or pharmacist searches by, e.g. "Paracetamol 500mg".
            $table->string('generic_name')->nullable();
            $table->string('unit')->nullable();     // pcs, kg, box, strip…
            $table->decimal('price', 12, 2)->default(0);
            $table->decimal('cost', 12, 2)->nullable();       // products only
            $table->decimal('discount_price', 12, 2)->nullable(); // optional sale price
            $table->json('price_tiers')->nullable();          // wholesale qty breaks: [{min_qty, price}]
            $table->decimal('min_order_qty', 12, 3)->nullable(); // wholesale: enforced on online orders
            $table->decimal('tax_rate', 5, 2)->nullable();    // percent, optional
            $table->json('attributes')->nullable();           // free-form specs
            $table->string('sold_by')->default('unit');       // unit | weight (decimal quantities)
            $table->decimal('stock_quantity', 12, 3)->default(0); // products only
            $table->decimal('low_stock_threshold', 12, 3)->nullable();
            $table->boolean('track_inventory')->default(true); // services: false
            $table->unsignedSmallInteger('duration_minutes')->nullable(); // services
            $table->time('available_from')->nullable();  // food: menu hours
            $table->time('available_until')->nullable();
            $table->boolean('is_active')->default(true)->index();
            $table->boolean('visible_in_marketplace')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'type']);
            $table->index(['tenant_id', 'item_type']);
            $table->index(['tenant_id', 'sku']);
            $table->index(['tenant_id', 'barcode']);
            $table->index(['tenant_id', 'name']);
        });

        // Which items belong to which collections (many-to-many, ordered).
        // Pivot: no surrogate key — the (collection, product) pair is unique.
        Schema::create('collection_item', function (Blueprint $table) {
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('collection_id')->constrained('collections')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->primary(['collection_id', 'product_id']);
            $table->index(['tenant_id', 'collection_id']);
        });

        Schema::create('product_variants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('name'); // e.g. "Red / Large"
            $table->string('sku')->nullable();
            $table->decimal('price', 12, 2);
            $table->decimal('cost', 12, 2)->nullable();
            $table->decimal('stock_quantity', 12, 3)->default(0);
            $table->decimal('low_stock_threshold', 12, 3)->nullable();
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'sku']);
            $table->index(['product_id', 'name']);
        });

        Schema::create('product_images', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('path');
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_images');
        Schema::dropIfExists('product_variants');
        Schema::dropIfExists('collection_item');
        Schema::dropIfExists('products');
        Schema::dropIfExists('collections');
        Schema::dropIfExists('expense_categories');
        Schema::dropIfExists('categories');
    }
};
