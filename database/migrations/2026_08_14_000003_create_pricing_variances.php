<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Carts where the offline pricing engine and the server disagreed.
 *
 * The evidence offline selling has to earn its way past. While the POS still
 * sells online, every completed sale is priced a SECOND time by the offline
 * engine and the answers are compared; the customer pays the server's price
 * either way, and only the disagreements land here.
 *
 * Two weeks of an empty table is a real answer to "does the mirror work",
 * built from carts a shop actually rang rather than carts we imagined. A single
 * row is a bug caught for the price of a comparison instead of the price of a
 * wrong receipt.
 *
 * DIAGNOSTICS, not accounting. Nothing here is money owed to anybody, nothing
 * reads it to decide a figure, and it is expected to be dropped once offline
 * selling has been trusted for a while.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pricing_variances', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            // Which till found it. A disagreement on one device and not another
            // is a stale catalog; on every device it is the engine.
            $table->foreignUuid('device_id')->nullable()->constrained('pos_devices')->nullOnDelete();
            // The sale the server created. Deliberately NOT a foreign key: a
            // finding must never be refused because the sale it names is not
            // (yet) here. Once tills sell offline, a variance and the sale it
            // came from travel as separate queues and can arrive in either
            // order, and voiding a sale must not take its evidence with it.
            // Losing a real finding over attribution is the wrong trade — the
            // same reasoning the device id follows.
            //
            // Unique per tenant, so a device re-sending a queue it never got an
            // acknowledgement for cannot double-report the same cart. That
            // matters because the COUNT is what this whole exercise reads.
            $table->uuid('sale_id')->nullable();

            // When the TILL found it, which is not when we received it — a
            // device offline for a day reports yesterday's disagreement today.
            $table->timestamp('found_at');

            $table->json('server_totals');
            $table->json('local_totals');
            $table->json('differences');
            // Enough of the cart to re-run by hand. A variance nobody can
            // reproduce is a variance nobody can fix.
            $table->json('cart');

            $table->timestamps();

            $table->unique(['tenant_id', 'sale_id']);
            $table->index(['tenant_id', 'found_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pricing_variances');
    }
};
