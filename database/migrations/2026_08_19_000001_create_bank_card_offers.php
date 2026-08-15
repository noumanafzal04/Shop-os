<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Banks that fund a discount on their own cards.
 *
 * ── This is not the shop's discount ─────────────────────────────────────
 *
 * HBL runs *10% off on HBL cards this Ramadan*. The customer pays ten per cent
 * less, and **the bank reimburses the shop**. The shop is a channel for
 * somebody else's marketing, and every decision below follows from that:
 *
 *   • the figure gets its OWN column, never folded into `discount` or
 *     `promo_discount`. Three different people's money — the cashier's
 *     goodwill, the shop's campaign, the bank's — and a shop that cannot
 *     separate them cannot invoice the bank for the third;
 *   • it applies to the CARD SLICE, not the bill. On a Rs 10,000 sale split
 *     Rs 3,000 cash and Rs 7,000 card, the bank funds a share of 7,000. It is
 *     discounting its own transaction, not the shop's;
 *   • a claim needs a reference, which is why `card_last4` exists at all.
 *
 * ── Why the last four digits, and nothing more ──────────────────────────
 *
 * `card_last4` is FOUR CHARACTERS and must stay four characters. A full card
 * number — a PAN — puts the shop and this platform inside PCI DSS, which is an
 * audit regime rather than a setting, and it is the kind of column that ends a
 * company when a database leaks.
 *
 * The first six digits are equally refused, tempting as they are: a bank can be
 * inferred from them and it would save the cashier a tap, but the first six
 * plus the last four is most of a PAN and the two halves would live in one
 * table. The cashier picks the bank from a list instead.
 *
 * ── Two tables, because a bank outlives its campaigns ───────────────────
 *
 * A bank is a relationship the shop keeps for years. An offer is a campaign
 * with dates that gets replaced every few months. One table would mean either
 * re-typing "HBL" every Ramadan or editing history in place.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('banks', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');
            // Printed on a 32-character receipt line, where "Habib Bank
            // Limited" does not fit and "HBL" does.
            $table->string('short_code', 12)->nullable();
            // Retired, not deleted: sales already point at it, and the reason
            // it was retired is exactly what somebody looks up afterwards.
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'is_active']);
            // One "HBL" per shop. A second one silently splits the claim report
            // in half, which is the one number this feature exists to produce.
            $table->unique(['tenant_id', 'name']);
        });

        Schema::create('bank_card_offers', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('bank_id')->constrained('banks')->cascadeOnDelete();
            // What the cashier picks and what the claim is filed under.
            $table->string('label');
            $table->string('type')->default('percent');       // percent | fixed
            $table->decimal('value', 12, 2);
            // "On Rs 5,000 and above" — the commonest shape of these deals.
            $table->decimal('min_spend', 12, 2)->nullable();
            // Not optional in practice on a percentage: uncapped, 10% of a
            // Rs 400,000 sale is a number nobody at either end agreed to.
            $table->decimal('max_discount', 12, 2)->nullable();
            // Some deals are credit-only. Cheap now; painful to retrofit onto
            // rows that were written without it.
            $table->json('card_types')->nullable();           // ["credit","debit"]
            // The campaign window. Identical four fields to `promotions`, and
            // read by the identical code — see App\Support\OfferWindow.
            $table->date('starts_on')->nullable();
            $table->date('ends_on')->nullable();
            $table->json('days_of_week')->nullable();         // 0 = Sunday
            $table->time('start_time')->nullable();
            $table->time('end_time')->nullable();
            $table->integer('priority')->default(0);
            $table->boolean('is_active')->default(true);
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'is_active']);
        });

        Schema::table('sales', function (Blueprint $table): void {
            $table->foreignUuid('bank_card_offer_id')->nullable()
                ->constrained('bank_card_offers')->nullOnDelete();
            // The rupee figure, on its own. This is what gets invoiced to the
            // bank, and it is the whole reason the feature is worth building.
            $table->decimal('bank_discount', 12, 2)->default(0);
            // FOUR characters. See the note above — never more.
            $table->string('card_last4', 4)->nullable();

            // "Everything HBL owes us for August" — the claim report's query,
            // and the only index this table needs for it.
            $table->index(['tenant_id', 'bank_card_offer_id']);
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'bank_card_offer_id']);
            $table->dropConstrainedForeignId('bank_card_offer_id');
            $table->dropColumn(['bank_discount', 'card_last4']);
        });

        Schema::dropIfExists('bank_card_offers');
        Schema::dropIfExists('banks');
    }
};
