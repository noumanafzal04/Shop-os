<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Orders a shop takes over the phone or on WhatsApp.
 *
 * Until now an order could only be created by a logged-in CUSTOMER through the
 * marketplace, and `orders.customer_id` was a required FK to `users`. That
 * quietly excluded the most common delivery order in Pakistan: the one that
 * arrives as a phone call.
 *
 * The consequences were real. A shop taking phone orders either rang them at
 * the till as ordinary counter sales — losing the whole fulfilment chain, so
 * no rider could be assigned, no status moved, and the kitchen or dispensary
 * had nothing to work from — or kept them on a paper chit beside the phone.
 * And a pharmacy that delivers but sells nothing online (marketplace off,
 * delivery on) had no way in at all, despite riders being deliberately gated
 * on `delivery` for exactly that case.
 *
 * Three columns:
 *
 *   customer_id nullable   a caller has no account and should not be made to
 *                          have one. The CRM Customer record (captured by
 *                          phone) is where they persist; a platform login is
 *                          a different thing entirely.
 *   channel                phone | whatsapp | online | walk_in. Which door the
 *                          order came through — the one dimension that
 *                          separates "we sold this online" from "someone rang
 *                          us", and a shop's answer to whether the online
 *                          storefront is earning its keep.
 *   created_by             the staff member who took the call. A phone order
 *                          is entered by a person, and when the address turns
 *                          out to be wrong, somebody has to be askable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->string('channel', 20)->default('online')->after('status');
            $table->foreignUuid('created_by')->nullable()->after('customer_id')
                ->constrained('users')->nullOnDelete();

            $table->index(['tenant_id', 'channel']);
        });

        // SQLite cannot alter a constrained column in place, so the FK is
        // dropped and re-added around the nullability change. Both engines end
        // up with the same shape: customer_id still points at users, but no
        // longer insists on one.
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropForeign(['customer_id']);
        });

        Schema::table('orders', function (Blueprint $table): void {
            $table->uuid('customer_id')->nullable()->change();
        });

        Schema::table('orders', function (Blueprint $table): void {
            $table->foreign('customer_id')->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'channel']);
            $table->dropConstrainedForeignId('created_by');
            $table->dropColumn('channel');
        });
    }
};
