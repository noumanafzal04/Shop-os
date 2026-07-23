<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A tenant's CRM directory. Auto-captured from sales/orders (by phone)
        // and manually editable (notes, address). Distinct from the global
        // `users` customer accounts — this is the shop's own record.
        Schema::create('customers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            $table->string('phone', 32)->nullable();
            $table->string('email')->nullable();
            $table->text('address')->nullable();
            $table->text('notes')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // One record per phone within a tenant (the dedup key on capture).
            $table->unique(['tenant_id', 'phone']);
            $table->index(['tenant_id', 'name']);
        });

        // Link walk-in sales to a CRM customer (set on capture when a phone
        // was given). Online orders match by phone snapshot instead.
        Schema::table('sales', function (Blueprint $table) {
            $table->uuid('customer_id')->nullable()->after('cash_session_id')->index();
        });
    }

    public function down(): void
    {
        Schema::table('sales', fn (Blueprint $t) => $t->dropColumn('customer_id'));
        Schema::dropIfExists('customers');
    }
};
