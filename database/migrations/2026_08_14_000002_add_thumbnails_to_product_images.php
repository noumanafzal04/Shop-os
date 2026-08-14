<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A small square version of each product photo.
 *
 * A phone photo is 2–4 MB, and a restaurant POS renders its menu as a grid of
 * them — so a 300-item menu asked a counter tablet for roughly a gigabyte over
 * a shop's connection. That is already the slowest thing about the online till;
 * offline it is impossible, because a device cannot hold it. At 200×200 WebP
 * the same menu is about 3 MB.
 *
 * Nullable on purpose. A corrupt upload, a format GD does not know, or a PHP
 * built without WebP must never cost a shopkeeper their photo — the column
 * stays null and everything falls back to the original.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_images', function (Blueprint $table): void {
            $table->string('thumb_path')->nullable()->after('path');
        });
    }

    public function down(): void
    {
        Schema::table('product_images', function (Blueprint $table): void {
            $table->dropColumn('thumb_path');
        });
    }
};
