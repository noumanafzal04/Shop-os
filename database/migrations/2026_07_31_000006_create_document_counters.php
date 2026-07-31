<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Per-tenant, per-type gap-free sequences (RET-…, and any future
        // numbered document). Generalises invoice_counters: the row is locked
        // and incremented inside the caller's transaction, so a rollback rolls
        // the increment back and concurrent writers can't mint the same number.
        Schema::create('document_counters', function (Blueprint $table): void {
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('type', 40); // sale_return | …
            $table->unsignedBigInteger('next_number')->default(1);
            $table->timestamps();

            $table->primary(['tenant_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_counters');
    }
};
