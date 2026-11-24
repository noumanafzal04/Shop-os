<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A BANNER CAN HEAD THE HOME — placement `home_top`.
 *
 * The app's home opens on one coloured block (address, search, slider). A
 * banner placed there is shown ONLY there, and the block takes its colour:
 * "admin side sy jo color chose ho wohi top header ka bny".
 *
 * Two ways to make one, because both were asked for:
 *  - `words`   — colour, title, a line, a button and a picture, laid out by
 *                the app (the picture is optional and any shape);
 *  - `artwork` — one finished 2:1 image shown edge to edge on that colour
 *                ("direct image upload kr sky fully control ho").
 *
 * The picture's size is the admin's too (`hero_image_size`, points), set
 * against a live preview of the phone's header.
 *
 * A `words` banner may have no picture, so `image_path` becomes nullable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('banners', function (Blueprint $table): void {
            $table->string('image_path')->nullable()->change();
            $table->string('body', 160)->nullable()->after('title');
            $table->string('cta_label', 30)->nullable()->after('body');
            $table->string('hero_color', 7)->nullable()->after('cta_label');
            $table->string('hero_style', 12)->nullable()->after('hero_color');
            // How big the picture sits beside the words, in app points.
            $table->unsignedSmallInteger('hero_image_size')->nullable()->after('hero_style');
        });
    }

    public function down(): void
    {
        Schema::table('banners', function (Blueprint $table): void {
            $table->dropColumn(['body', 'cta_label', 'hero_color', 'hero_style', 'hero_image_size']);
        });
    }
};
