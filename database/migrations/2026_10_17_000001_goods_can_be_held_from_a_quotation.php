<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * GOODS HELD FROM A QUOTATION (B65).
 *
 * A customer comes back with the quote in hand and puts money down. The
 * advance used to be typed out again from nothing — at today's prices, not the
 * ones on the paper — and the quote stayed "open" beside it for ever. The
 * advance now says which quote it was held from, and the quote closes by
 * itself (the owner, 2026-10-16). One column, read both ways: the advance's
 * `source`, and the quote's `held_as`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_documents', function (Blueprint $table): void {
            $table->uuid('source_document_id')->nullable()->after('sale_id')->index();
        });
    }

    public function down(): void
    {
        Schema::table('sale_documents', function (Blueprint $table): void {
            $table->dropIndex(['source_document_id']);
            $table->dropColumn('source_document_id');
        });
    }
};
