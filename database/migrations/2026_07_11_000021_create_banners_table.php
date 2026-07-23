<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Platform-level promo banners (paid ads). Admin-created only. Shown on
        // the mobile/marketplace home; a tap deep-links to the advertiser's
        // shop / a product / a URL. Ad fee is recorded manually (like subs).
        Schema::create('banners', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // Advertiser (the paying shop). Null = house/platform banner.
            $table->foreignUuid('tenant_id')->nullable()->constrained('tenants')->nullOnDelete();
            $table->string('title')->nullable();       // optional caption
            $table->string('image_path');
            $table->string('target_type')->default('shop'); // shop | product | url | none
            $table->foreignUuid('target_product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('target_url')->nullable();
            $table->string('placement')->default('home'); // home | marketplace_top
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            // Ad billing (manual — matches COD/transfer subscription model).
            $table->decimal('amount', 12, 2)->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->text('notes')->nullable();
            $table->unsignedInteger('impression_count')->default(0);
            $table->unsignedInteger('click_count')->default(0);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['placement', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('banners');
    }
};
