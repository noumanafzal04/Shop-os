<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Pharmacy: capture the prescription behind a sale of Rx-required
     * medicines. Today the POS only WARNS; these columns let it RECORD who
     * prescribed/received what, on the sale itself (so it travels with the
     * sale — important for the offline queue and for a dispensing record).
     */
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->string('prescription_number')->nullable()->after('notes');
            $table->string('prescriber_name')->nullable()->after('prescription_number');
            $table->string('patient_name')->nullable()->after('prescriber_name');
            $table->text('prescription_notes')->nullable()->after('patient_name');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropColumn(['prescription_number', 'prescriber_name', 'patient_name', 'prescription_notes']);
        });
    }
};
