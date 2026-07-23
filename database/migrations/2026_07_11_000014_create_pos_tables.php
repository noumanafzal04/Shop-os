<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Cash sessions (shifts) — one open per cashier at a time. Closing
        // reconciles counted cash against expected (opening + cash sales).
        Schema::create('cash_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('status')->default('open'); // open | closed
            $table->decimal('opening_float', 12, 2)->default(0);
            $table->decimal('cash_sales', 12, 2)->default(0);   // computed at close
            $table->decimal('expected_cash', 12, 2)->nullable();
            $table->decimal('counted_cash', 12, 2)->nullable();
            $table->decimal('variance', 12, 2)->nullable();     // counted - expected
            $table->unsignedInteger('sales_count')->default(0);
            $table->decimal('sales_total', 12, 2)->default(0);
            $table->text('notes')->nullable();
            $table->timestamp('opened_at');
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'user_id', 'status']);
        });

        // Held (parked) sales — a cashier can suspend a cart and resume later.
        Schema::create('held_sales', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('label')->nullable();     // e.g. "Table 4" / customer name
            $table->json('cart');                     // opaque client cart snapshot
            $table->decimal('total_estimate', 12, 2)->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('held_sales');
        Schema::dropIfExists('cash_sessions');
    }
};
