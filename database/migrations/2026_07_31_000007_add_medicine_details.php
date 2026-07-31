<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Pharmacy catalog depth: a medicine's strength (e.g. "500mg") and its
        // dosage form (tablet / syrup / injection …). Both descriptive, so
        // nullable and shown only for medicine items — they don't affect
        // pricing or stock. generic_name / requires_prescription already exist.
        Schema::table('products', function (Blueprint $table): void {
            $table->string('strength', 60)->nullable()->after('generic_name');
            $table->string('dosage_form', 40)->nullable()->after('strength');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table): void {
            $table->dropColumn(['strength', 'dosage_form']);
        });
    }
};
