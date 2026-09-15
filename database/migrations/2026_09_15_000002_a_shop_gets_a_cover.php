<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * THE BIG PICTURE AT THE TOP OF A SHOP.
 *
 * ── What stood in for it, and why that was wrong ────────────────────────
 *
 * The shop page's hero read `gallery[0]`, and the gallery is gated on
 * `feature:services` — the route says so in its own comment: "a mart or
 * pharmacy has no portfolio". Measured against the type defaults, that is:
 *
 *     food no · mart no · pharmacy no · retail no · services YES · automotive YES
 *
 * So a restaurant could not set the biggest image in the app. KFC's hero could
 * only ever be its logo, or a coloured letter. The question that surfaced it
 * was four words — "where to change shop cover image?" — and the answer was
 * "you cannot, unless you are a workshop".
 *
 * ── Why a column and not simply opening the gallery up ──────────────────
 *
 * Because they are different things. A portfolio is a body of WORK — the
 * bathroom you tiled, the bike you resprayed — and it is a list. A cover is
 * one photograph of the shop, and every shop has one whether or not it has
 * work to show. Opening the gallery to everyone would put the word "Portfolio"
 * in a grocer's menu and make the hero depend on which image happened to sort
 * first.
 *
 * One nullable column, one upload, beside the logo where a shopkeeper already
 * goes to change how their shop looks.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            // Beside `logo_path` deliberately: the two are the same KIND of
            // fact — how this shop looks — and a reader of the schema should
            // meet them together.
            $table->string('cover_path')->nullable()->after('logo_path');
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            $table->dropColumn('cover_path');
        });
    }
};
