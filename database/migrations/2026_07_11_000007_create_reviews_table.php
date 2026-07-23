<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reviews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('customer_id')->constrained('users')->cascadeOnDelete();
            $table->unsignedTinyInteger('rating'); // 1..5
            $table->text('comment')->nullable();
            $table->text('reply')->nullable();      // owner's response
            $table->timestamp('replied_at')->nullable();
            $table->boolean('is_published')->default(true); // moderation flag
            $table->timestamps();

            // Edge case "duplicate review": one review per customer per shop —
            // posting again UPDATES it instead of stacking duplicates.
            $table->unique(['tenant_id', 'customer_id']);
            $table->index(['tenant_id', 'is_published']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reviews');
    }
};
