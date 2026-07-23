<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A shop's own delivery riders (Model A — tenant-owned). No rider app
        // or GPS yet; the shop assigns a delivery order to one of these riders
        // and moves it through the order's own status flow.
        Schema::create('riders', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            $table->string('phone', 32)->nullable();
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'is_active']);
        });

        // Which rider is carrying a delivery order (null = unassigned). The
        // rider's progress is derived from the order status (assigned → out
        // for delivery = on the way → completed = delivered).
        Schema::table('orders', function (Blueprint $table): void {
            $table->foreignUuid('rider_id')->nullable()->after('sale_id')
                ->constrained('riders')->nullOnDelete();
            $table->timestamp('rider_assigned_at')->nullable()->after('rider_id');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('rider_id');
            $table->dropColumn('rider_assigned_at');
        });
        Schema::dropIfExists('riders');
    }
};
