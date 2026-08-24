<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Some acts are about a KIND of thing, not about one of them.
 *
 * A product's price change belongs to that product and always will. A price
 * LIST imported over three hundred of them does not: it is one act, by one
 * person, at one moment, and filing it three hundred times would push every
 * hand-made price change off the first page of the trail — the failure the
 * audit allowlist exists to avoid.
 *
 * So the trail has to be able to say "products were imported" as well as "this
 * product's price moved", and `auditable_type` already carries which kind. The
 * column was NOT NULL, so the only way to record the operation was to pretend
 * it happened to a row.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->uuid('auditable_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        // Rows about a kind rather than a record cannot survive the column
        // becoming NOT NULL again, and inventing an id for them would be worse
        // than losing them: it would point the trail at a product that never
        // had that price.
        Schema::table('audit_logs', function (Blueprint $table) {
            $table->uuid('auditable_id')->nullable(false)->change();
        });
    }
};
