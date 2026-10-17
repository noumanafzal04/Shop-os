<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Q19 A (the client, 2026-10-17): a customer bought eight items, the bill is
 * printed, they want two more. The paid bill is never changed; the two are a
 * new ordinary sale that names the bill it was added to, and its receipt
 * shows both and what they come to together.
 *
 * Additive: a nullable link (its foreign key indexes it). Every sale before it adds to none.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->uuid('adds_to_sale_id')->nullable()->after('exchange_credit');
            // The foreign key brings its own index; a second would be the same one twice.
            $table->foreign('adds_to_sale_id')->references('id')->on('sales')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropForeign(['adds_to_sale_id']);
            $table->dropColumn('adds_to_sale_id');
        });
    }
};
