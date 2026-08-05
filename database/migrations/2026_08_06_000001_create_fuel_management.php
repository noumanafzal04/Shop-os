<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fuel management — the one thing a petrol pump does that no other shop does.
 *
 * Every other business type in ShopOS shares one assumption: you know what left
 * the shelf because someone rang it up. A forecourt does not work that way. The
 * fuel is in a tank underground, it leaves through a meter, and the till is the
 * LAST thing to hear about it — often not at all. So a pump is run off two
 * independent measurements, and the whole job is comparing them:
 *
 *   THE METER   — every nozzle carries a cumulative totaliser that only ever
 *                 counts up. Litres dispensed on a shift = closing − opening,
 *                 less any test litres pumped into a measure and tipped back.
 *                 This is what physically went into customers' cars.
 *
 *   THE DIP     — the tank is measured at shift open and close. Book stock is
 *                 opening dip + deliveries − meter litres; the closing dip is
 *                 what's actually down there.
 *
 * Two subtractions, two completely different problems, and this is why both
 * must exist:
 *
 *   meter litres vs litres rung at the till → fuel that left the pump and was
 *       never billed. That is an attendant problem.
 *   book stock vs closing dip              → fuel that left the TANK without
 *       going through a meter. That is a leak, an evaporation loss, or someone
 *       drawing straight from the tank.
 *
 * Collapse them into one number and you can no longer tell a theft at the
 * nozzle from a hole in the ground, which is precisely the distinction the
 * owner is trying to make.
 *
 * ── Why the meter is not simply "stock" ─────────────────────────────────
 *
 * Fuel IS a Product — it has a price, it is rung at the till, it depletes stock
 * like anything else, and a customer buying Rs 2,000 of petrol is an ordinary
 * sale. What these tables add is the physical measurement alongside it. The
 * reconciliation posts ONE stock adjustment at close, against the dip, because
 * the dip is the only measurement of what is actually in the tank.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── The physical plant ──────────────────────────────────────
        Schema::create('fuel_tanks', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            // A station is a Branch. Tanks belong to one.
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            // What's in it. The fuel is an ordinary Product — priced, sold and
            // stocked like anything else — so the tank points AT the catalog
            // rather than duplicating a price nobody would remember to update.
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('name');                                  // "Tank 1 — Petrol"
            $table->decimal('capacity_litres', 12, 3)->default(0);
            // The last dip taken. Carried forward so a shift opens on the
            // number the previous shift closed on — a gap between them is
            // itself a finding.
            $table->decimal('current_dip_litres', 12, 3)->default(0);
            // The unpumpable bottom: below this the pumps draw air and sludge.
            // Capacity minus dead stock is what can actually be sold.
            $table->decimal('dead_stock_litres', 12, 3)->default(0);
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'branch_id']);
            $table->index(['tenant_id', 'product_id']);
        });

        Schema::create('fuel_pumps', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('name');   // "Pump 2"
            $table->string('code')->nullable();
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'branch_id']);
        });

        Schema::create('fuel_nozzles', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('fuel_pump_id')->constrained('fuel_pumps')->cascadeOnDelete();
            // Which tank this nozzle draws from — the link that lets meter
            // litres be subtracted from the right tank's book stock.
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->cascadeOnDelete();
            $table->string('name');   // "A1"
            // The cumulative totaliser. NEVER reset, never decremented — a
            // meter that can go backwards is a meter that can hide a shift.
            // Wide enough for the mechanical 6-digit heads that roll over at
            // 999999.999 and for modern electronic ones that don't.
            $table->decimal('current_reading', 14, 3)->default(0);
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'fuel_pump_id']);
            $table->index(['tenant_id', 'fuel_tank_id']);
        });

        // ── The shift ───────────────────────────────────────────────
        // Deliberately NOT the cash_sessions shift. That one is a cashier at a
        // drawer; this one is the whole forecourt between two sets of readings,
        // and on a busy pump three cashiers come and go inside one of them.
        Schema::create('forecourt_shifts', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('number');                       // FC-000001
            $table->string('status', 20)->default('open');  // open | closed
            $table->foreignUuid('opened_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('opened_at');
            $table->timestamp('closed_at')->nullable();

            // Everything below is written ONCE, at close, and never recomputed.
            // A shift reconciled last March must show the same numbers next
            // March even if a price was edited or a nozzle reassigned since —
            // otherwise a variance somebody signed off silently changes.
            $table->decimal('litres_sold', 14, 3)->default(0);
            $table->decimal('test_litres', 12, 3)->default(0);
            $table->decimal('fuel_value', 14, 2)->default(0);
            // What the till actually rang for these products over the shift's
            // window — the other half of the comparison.
            $table->decimal('pos_fuel_value', 14, 2)->default(0);
            $table->decimal('pos_fuel_litres', 14, 3)->default(0);
            // meter − till. Positive = fuel went out unbilled.
            $table->decimal('unbilled_litres', 14, 3)->default(0);
            $table->decimal('unbilled_value', 14, 2)->default(0);
            // book − dip, summed over tanks. Positive = fuel missing from the
            // ground that no meter accounts for.
            $table->decimal('tank_variance_litres', 14, 3)->default(0);
            $table->decimal('tank_variance_value', 14, 2)->default(0);
            // True when a price notification landed mid-shift, so the valuation
            // above is an approximation and the reader should know it.
            $table->boolean('price_changed_during')->default(false);

            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'branch_id', 'status']);
            $table->index(['tenant_id', 'opened_at']);
        });

        Schema::create('forecourt_readings', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('forecourt_shift_id')->constrained('forecourt_shifts')->cascadeOnDelete();
            $table->foreignUuid('fuel_nozzle_id')->constrained('fuel_nozzles')->cascadeOnDelete();
            // Snapshots, so a renamed or retired nozzle never orphans a shift.
            $table->string('nozzle_name');
            $table->string('pump_name');
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('product_name');

            $table->decimal('opening_reading', 14, 3);
            $table->decimal('closing_reading', 14, 3)->nullable();
            // Litres pumped into a calibration measure and tipped back into the
            // tank. They cross the meter but were never sold, so they come off
            // the litres AND go back onto the tank — miss this and the pump
            // shows a theft every time it is checked for accuracy.
            $table->decimal('test_litres', 12, 3)->default(0);
            $table->decimal('litres_sold', 14, 3)->default(0);
            // The rate in force when the shift opened, snapshotted.
            $table->decimal('unit_price', 12, 2)->default(0);
            $table->decimal('value', 14, 2)->default(0);
            $table->timestamps();

            $table->unique(['forecourt_shift_id', 'fuel_nozzle_id']);
            $table->index(['tenant_id', 'forecourt_shift_id']);
        });

        Schema::create('forecourt_dips', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('forecourt_shift_id')->constrained('forecourt_shifts')->cascadeOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->cascadeOnDelete();
            $table->string('tank_name');
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();

            $table->decimal('opening_dip', 12, 3);
            $table->decimal('closing_dip', 12, 3)->nullable();
            $table->decimal('delivered_litres', 12, 3)->default(0);
            $table->decimal('meter_litres', 14, 3)->default(0);
            // opening + delivered − meter. What should be down there.
            $table->decimal('book_closing', 12, 3)->default(0);
            // book − actual. Positive = missing.
            $table->decimal('variance_litres', 12, 3)->default(0);
            $table->decimal('variance_value', 14, 2)->default(0);
            $table->timestamps();

            $table->unique(['forecourt_shift_id', 'fuel_tank_id']);
            $table->index(['tenant_id', 'forecourt_shift_id']);
        });

        // ── The tanker ──────────────────────────────────────────────
        Schema::create('fuel_deliveries', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->cascadeOnDelete();
            // The shift it landed in, so its litres join that shift's book.
            $table->foreignUuid('forecourt_shift_id')->nullable()->constrained('forecourt_shifts')->nullOnDelete();
            $table->foreignUuid('supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
            $table->string('invoice_number')->nullable();
            $table->string('tanker_number')->nullable();
            // What the invoice says was delivered.
            $table->decimal('invoiced_litres', 12, 3);
            // The dips either side. Delivered-by-dip is the shop's own
            // measurement, and it is routinely a few hundred litres short of
            // the invoice — which is the entire reason to record both.
            $table->decimal('dip_before', 12, 3)->nullable();
            $table->decimal('dip_after', 12, 3)->nullable();
            $table->decimal('received_litres', 12, 3);
            // invoiced − received. Positive = short delivery.
            $table->decimal('shortage_litres', 12, 3)->default(0);
            $table->decimal('unit_cost', 12, 3)->default(0);
            $table->decimal('total_cost', 14, 2)->default(0);
            $table->timestamp('received_at');
            $table->foreignUuid('received_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'fuel_tank_id']);
            $table->index(['tenant_id', 'received_at']);
        });

        // ── The notification ────────────────────────────────────────
        // Fuel prices move by government order, usually at midnight, and the
        // whole forecourt reprices at once. Logged rather than silently
        // overwritten: a shift straddling a change values its litres at a rate
        // that has to be defensible weeks later.
        Schema::create('fuel_price_changes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->decimal('old_price', 12, 2);
            $table->decimal('new_price', 12, 2);
            $table->timestamp('effective_at');
            $table->foreignUuid('changed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'product_id', 'effective_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_price_changes');
        Schema::dropIfExists('fuel_deliveries');
        Schema::dropIfExists('forecourt_dips');
        Schema::dropIfExists('forecourt_readings');
        Schema::dropIfExists('forecourt_shifts');
        Schema::dropIfExists('fuel_nozzles');
        Schema::dropIfExists('fuel_pumps');
        Schema::dropIfExists('fuel_tanks');
    }
};
