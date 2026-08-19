<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * THE SEQUENCE, AS A NUMBER, BESIDE THE LABEL IT WAS PRINTED IN.
 *
 * A till mints its own slip numbers offline: `OFF-<lane>-<device>-<000001>`.
 * The counter behind that last part lives in the browser's IndexedDB, while the
 * device id it is paired with lives in localStorage — two storage layers with
 * different eviction rules. Lose the first and keep the second and the counter
 * restarts at one under the same device segment, so every sale from then on
 * carries a slip the shop already has.
 *
 * The cure is for the server to be able to answer "what is the highest you have
 * seen from this till?" on the next pull, and for the till to start above it.
 * Answering that from the LABEL means parsing a string in SQL, and the label
 * now has a disambiguated form (`…-D2`) which such a parse would get wrong.
 *
 * So the sequence is stored as what it is: a number. Same lesson as the receipt
 * tray — order events by the sequence column, never by a rendering of it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->unsignedInteger('offline_seq')->nullable()->after('offline_number');

            // The only question ever asked of it: the high-water mark for one
            // till. Device first, because that is what is always known.
            $table->index(['pos_device_id', 'offline_seq'], 'sales_device_offline_seq_index');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropIndex('sales_device_offline_seq_index');
            $table->dropColumn('offline_seq');
        });
    }
};
