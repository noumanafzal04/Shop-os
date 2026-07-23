<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Order-scoped stock movements use composite idempotency keys made of two
 * UUIDs (order + product/variant), which exceed 64 chars. Widen the column
 * so MySQL stores them (SQLite never enforced the limit).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->string('idempotency_key', 191)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->string('idempotency_key', 64)->nullable()->change();
        });
    }
};
