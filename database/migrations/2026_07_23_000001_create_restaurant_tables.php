<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dine-in restaurant depth: a floor of tables, a running tab (ticket) per
 * table that accumulates items over the meal, kitchen tickets (KOT) fired to
 * the kitchen, and settlement (full or split-by-item) into one or more Sales.
 *
 * Design:
 *  - A `dining_table` is just floor furniture; "occupied" is DERIVED from
 *    whether it has an open ticket (no status column to drift).
 *  - A `restaurant_ticket` is the running tab. Items live on it and get FIRED
 *    to the kitchen in batches (each batch = one `kitchen_ticket`).
 *  - Each `restaurant_ticket_item` stores BOTH the raw selection (so the bill
 *    is re-priced server-authoritatively at settlement, exactly like a counter
 *    sale) AND a display snapshot (so the waiter sees a running total cheaply).
 *  - Settlement rings the selected items through CreateSaleAction → a Sale;
 *    `sale_id` on the item marks it paid. The tab CLOSES when every non-void
 *    item is settled — supporting split-by-item (each subset = its own Sale).
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── The floor: tables a waiter can seat guests at ────────────────
        Schema::create('dining_tables', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');            // "T1", "Patio 3"
            $table->string('area')->nullable(); // "Garden", "Rooftop", "Hall"
            $table->unsignedSmallInteger('seats')->nullable();
            $table->integer('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'is_active']);
        });

        // ── The running tab ──────────────────────────────────────────────
        Schema::create('restaurant_tickets', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('ticket_number');   // display label, e.g. TAB-00001
            $table->foreignUuid('dining_table_id')->nullable()->constrained('dining_tables')->nullOnDelete();
            $table->string('order_type')->default('dine_in'); // dine_in | takeaway
            $table->string('status')->default('open');        // open | closed | void
            $table->unsignedSmallInteger('guest_count')->nullable();
            $table->string('customer_name')->nullable();
            $table->string('customer_phone')->nullable();
            $table->text('notes')->nullable();
            // Set when the tab was settled as a SINGLE sale; split settlements
            // leave this null (per-item sale_id carries the linkage instead).
            $table->uuid('sale_id')->nullable()->index();
            $table->timestamp('opened_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'dining_table_id', 'status']);
        });

        // ── Kitchen tickets (KOT) — a batch of items fired to the kitchen ─
        Schema::create('kitchen_tickets', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('ticket_id')->constrained('restaurant_tickets')->cascadeOnDelete();
            $table->unsignedInteger('kot_number'); // per-ticket fire sequence: #1, #2…
            $table->string('station')->nullable(); // "Kitchen", "Bar", "Grill"
            $table->string('status')->default('fired'); // fired | preparing | ready | served
            $table->text('notes')->nullable();
            $table->timestamp('fired_at')->nullable();
            $table->uuid('fired_by')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'ticket_id']);
        });

        // ── Tab line items ────────────────────────────────────────────────
        Schema::create('restaurant_ticket_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('ticket_id')->constrained('restaurant_tickets')->cascadeOnDelete();
            // Fired to the kitchen as part of this KOT (null = not yet fired).
            $table->foreignUuid('kitchen_ticket_id')->nullable()->constrained('kitchen_tickets')->nullOnDelete();
            // The sale that settled this item (null = still unpaid on the tab).
            $table->uuid('sale_id')->nullable()->index();

            // ── Raw selection (replayed server-authoritatively at settlement) ──
            $table->uuid('product_id');
            $table->uuid('variant_id')->nullable();
            $table->uuid('product_unit_id')->nullable();
            $table->decimal('quantity', 12, 3)->default(1);
            $table->string('price_level')->default('retail'); // retail | wholesale
            $table->json('modifier_option_ids')->nullable();  // selected add-on option ids
            $table->decimal('line_discount', 12, 2)->default(0);
            $table->decimal('line_discount_pct', 5, 2)->nullable();

            // ── Display snapshot (running total, KOT print) ────────────────
            $table->string('product_name');
            $table->string('variant_name')->nullable();
            $table->string('unit_name')->nullable();
            $table->string('sku')->nullable();
            $table->json('modifiers')->nullable(); // resolved snapshot [{group,name,price_delta}]
            $table->decimal('unit_price', 12, 2)->default(0);
            $table->decimal('unit_cost', 12, 2)->nullable();
            $table->decimal('unit_factor', 12, 3)->default(1);
            $table->decimal('line_total', 12, 2)->default(0);

            // Kitchen note ("no onions") + lifecycle.
            $table->string('kot_status')->default('pending'); // pending | fired | void
            $table->text('note')->nullable();
            $table->timestamp('voided_at')->nullable();
            $table->string('void_reason')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'ticket_id']);
            $table->index('kitchen_ticket_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('restaurant_ticket_items');
        Schema::dropIfExists('kitchen_tickets');
        Schema::dropIfExists('restaurant_tickets');
        Schema::dropIfExists('dining_tables');
    }
};
