<?php

use App\Support\UnitsBackOnTheShelf;
use Illuminate\Database\Migrations\Migration;

/**
 * Data only — no table changes.
 *
 * Phones refunded or exchanged before 2026-10-07 stayed `sold` under their
 * numbers: on the shelf, refused at the till. See UnitsBackOnTheShelf for
 * what is mended and what is deliberately left alone.
 */
return new class extends Migration
{
    public function up(): void
    {
        UnitsBackOnTheShelf::repair();
    }

    public function down(): void
    {
        // Nothing to undo: it put units where the sales already said they were.
    }
};
