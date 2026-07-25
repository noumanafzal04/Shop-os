<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('business_name');
            $table->string('slug')->unique();
            $table->string('email')->nullable();
            $table->string('phone')->nullable();
            // Business-type awareness: type drives defaults (categories,
            // expense templates, feature matrix) — never hardcoded retail.
            $table->string('business_type')->nullable()->index();
            $table->string('business_category')->nullable();
            // Effective feature flags (from type defaults, tenant-adjustable).
            $table->json('features')->nullable();

            // Per-tenant limit overrides ("extend his plan"). Sparse map of
            // {limit_key: value}; a key present here wins over the plan's
            // baseline for THIS tenant only. Absent/empty → plain plan limits.
            // e.g. {"products": 5000} lifts just this shop's product ceiling.
            $table->json('limit_overrides')->nullable();
            $table->foreignUuid('city_id')->nullable()->constrained('cities')->nullOnDelete();
            $table->foreignUuid('plan_id')->nullable()->constrained('plans')->nullOnDelete();

            // Effective module flag (copied from plan on assignment; Super Admin controlled).
            $table->boolean('online_shop_enabled')->default(false)->index();

            $table->string('status')->default('active')->index(); // active | suspended
            $table->timestamp('subscription_starts_at')->nullable();
            $table->timestamp('subscription_ends_at')->nullable()->index();

            // Shop setup (Step 6) — optional fields.
            $table->string('logo_path')->nullable();
            $table->string('address')->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->json('business_hours')->nullable();
            // IANA zone the shop's wall-clock (hours, food serving windows,
            // coupon dates) is interpreted in. Server runs UTC; this keeps a
            // "closes 22:00" shop closing at 22:00 local, not 22:00 UTC.
            $table->string('timezone')->default('Asia/Karachi');
            $table->boolean('setup_completed')->default(false);

            $table->json('settings')->nullable();

            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // Duplicate business name/phone/email are checked in FormRequests
            // (unique-with-soft-delete semantics), backed by indexes here.
            $table->index('business_name');
            $table->index('email');
            $table->index('phone');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenants');
    }
};
