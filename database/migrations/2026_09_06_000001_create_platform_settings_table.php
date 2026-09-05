<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SETTINGS THAT BELONG TO THE PLATFORM, not to a shop.
 *
 * `ShopSettings` is a JSON column on `tenants` because every shop has its own.
 * There is only ever ONE platform, so this is a key/value table read through
 * `PlatformSettings`, which owns the defaults and the validation exactly the
 * way `ShopSettings` does for a tenant.
 *
 * A row here means somebody CHANGED something. A key with no row falls back to
 * the default in code, so the defaults can be improved for everyone without a
 * data migration — and so a fresh install has no seeding step before it works.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_settings', function (Blueprint $table): void {
            $table->string('key')->primary();
            // JSON rather than a string column: a rate is a number, a toggle is
            // a boolean, and casting them back out of text is where "0" and 0
            // and false start meaning different things in different readers.
            $table->json('value');
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_settings');
    }
};
