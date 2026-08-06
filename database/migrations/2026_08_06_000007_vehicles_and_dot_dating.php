<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two things a tyre and auto shop knows that the software did not.
 *
 * ── The vehicle ──────────────────────────────────────────────────────
 * A customer is remembered by phone number, which is the right key for a
 * grocery but the wrong one here. What the counter actually needs to know when
 * someone walks in is "what does this car take?" and "what did we fit last
 * time, and when?". Ask a tyre shop about a regular and they answer with a
 * registration plate, not a person: LEA-1234, the white Corolla, 195/65 R15,
 * fitted a set in March.
 *
 * Without it, every visit starts by measuring a tyre again, warranty claims
 * have nothing to hang off, and the shop cannot tell the customer their
 * alignment is due — which is the whole reason they would come back here
 * rather than the next shop down the road.
 *
 * One vehicle belongs to one customer, but a sale points at the vehicle, not
 * through the customer: a fleet buys ten vans on one account, and "what did we
 * do to THIS van" has to survive that.
 *
 * ── The DOT code ─────────────────────────────────────────────────────
 * Every tyre carries a four-digit code on the sidewall — 2224 is week 22 of
 * 2024. Rubber ages on the shelf whether or not anyone drives on it, and a
 * tyre that has never touched a road is still not something to sell after six
 * years. This is not an expiry date and must not be modelled as one: nothing
 * becomes illegal on a given day, the shop simply needs to see how old a batch
 * is, sell the oldest first, and be warned before a customer asks.
 *
 * Stored on product_batches beside the pharmacy's expiry dates, because it is
 * the same shape of fact — this LOT, received on this day, has this age — and
 * the batch engine already does first-expiry-first-out.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_vehicles', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('customer_id')->nullable()->constrained('customers')->nullOnDelete();

            // The plate. How the shop actually names the vehicle, so it is the
            // search key — unique per shop, because two cars cannot share one.
            $table->string('registration', 32);
            $table->string('make', 60)->nullable();     // Toyota
            $table->string('model', 60)->nullable();    // Corolla GLi
            $table->unsignedSmallInteger('year')->nullable();
            $table->string('colour', 40)->nullable();
            // "195/65 R15" — what it takes. Written down once so nobody has to
            // crouch by the wheel arch on the next visit.
            $table->string('tyre_size', 40)->nullable();
            $table->string('engine_no', 40)->nullable();
            $table->string('chassis_no', 40)->nullable();

            // Last reading seen. Service intervals are a distance, not a date,
            // and a shop that never wrote the odometer down can only guess.
            $table->unsignedInteger('odometer')->nullable();
            $table->date('odometer_at')->nullable();

            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'registration']);
            $table->index(['tenant_id', 'customer_id']);
        });

        Schema::table('sales', function (Blueprint $table): void {
            // Which vehicle the work was done on. Nullable everywhere else in
            // the platform's life; a grocery will never set it.
            $table->foreignUuid('vehicle_id')->nullable()->after('customer_id')
                ->constrained('customer_vehicles')->nullOnDelete();
            // The reading at the time of THIS job — the number a service
            // reminder is counted from.
            $table->unsignedInteger('odometer')->nullable()->after('vehicle_id');
        });

        Schema::table('product_batches', function (Blueprint $table): void {
            // The sidewall code, kept as written: "2224". Two digits of week
            // and two of year, and worth storing verbatim because that is what
            // a customer will point at when they query the age.
            $table->string('dot_code', 8)->nullable()->after('batch_number');
            // Derived from it (or entered directly for anything else that ages
            // on a shelf). A DATE rather than an expiry: nothing expires, the
            // shop just needs to know how old the lot is.
            $table->date('manufactured_on')->nullable()->after('dot_code');

            $table->index(['tenant_id', 'manufactured_on']);
        });
    }

    public function down(): void
    {
        Schema::table('product_batches', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'manufactured_on']);
            $table->dropColumn(['dot_code', 'manufactured_on']);
        });
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('vehicle_id');
            $table->dropColumn('odometer');
        });
        Schema::dropIfExists('customer_vehicles');
    }
};
