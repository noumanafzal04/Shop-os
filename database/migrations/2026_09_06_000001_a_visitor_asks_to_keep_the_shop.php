<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "KEEP THIS SHOP" — a demo asking to become a business.
 *
 * The visitor has spent a while in a demo, put their own products into it and
 * probably rung a sale. Everything they built is in that tenant, so this is a
 * request to CONVERT it, never to start again somewhere else — losing their
 * work at the exact moment they asked to stay would be the worst possible
 * reply.
 *
 * ── While it is pending, the shop keeps working ────────────────────────
 *
 * Pressing this is the strongest buying signal there is, and switching the
 * shop off at that moment is backwards. There is nothing to protect either:
 * they are using a demo they already had. So the shop carries on, the demo
 * clock stops mattering, and `PruneDemoShops` will not touch a tenant with a
 * request outstanding.
 *
 * The bound is on the ADMIN answering, not on a timer that deletes a waiting
 * customer's work. `requested_at` is what the admin list sorts by, oldest
 * first, so a request cannot rot quietly.
 *
 * ── What this form does NOT ask ────────────────────────────────────────
 *
 * The business name, the city, the address, the map pin. Every one of those is
 * asked by the setup wizard the app already has, and approval puts the shop
 * back through it — `setup_completed` returns to false, so the owner names
 * their own business rather than living with "Mart Demo K7QP". Asking here as
 * well would be two forms asking one question, which is how the two answers
 * start disagreeing.
 *
 * What is asked is only what the ADMIN needs in order to decide and to reply:
 * a human being and a way to reach them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shop_requests', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();

            // WHO TO WRITE BACK TO. The demo's own owner row carries a
            // throwaway address nobody reads, so the contact is asked for
            // here — it is the whole reason this record exists.
            $table->string('contact_name');
            $table->string('contact_email');
            $table->string('contact_phone')->nullable();
            $table->text('note')->nullable();

            $table->string('status')->default('pending'); // pending|approved|declined
            $table->timestamp('requested_at');
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('decline_reason')->nullable();

            $table->timestamps();

            // ONE OPEN REQUEST PER SHOP. Pressing the button twice is a person
            // being unsure, not a second business — and two rows would give
            // the admin two things to answer about one shop.
            $table->unique(['tenant_id', 'status'], 'shop_requests_one_open_per_shop');
            $table->index(['status', 'requested_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shop_requests');
    }
};
