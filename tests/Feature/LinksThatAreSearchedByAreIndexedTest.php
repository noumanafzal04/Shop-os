<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * A COLUMN SOMETHING SEARCHES BY HAS AN INDEX UNDER IT.
 *
 * Two did not (docs/qa/2026-10-11-duplicate-columns-audit.md): the units a
 * sale took, found again when that sale is cancelled or returned; and the
 * expenses a monthly bill has posted. Both were a read of the whole table for
 * the shop — nothing on a new one, and a slow screen on a phone shop three
 * years in.
 *
 * Held by name of the COLUMNS, not of the index: an index that is renamed is
 * still an index, and one that is dropped in a tidy-up is not.
 */
class LinksThatAreSearchedByAreIndexedTest extends TestCase
{
    use RefreshDatabase;

    /** @return list<list<string>> */
    private function indexed(string $table): array
    {
        return array_map(fn (array $index): array => $index['columns'], Schema::getIndexes($table));
    }

    public function test_the_units_a_sale_took_can_be_found_without_reading_every_unit(): void
    {
        $this->assertContains(['tenant_id', 'sale_id'], $this->indexed('product_serials'));
    }

    public function test_what_a_monthly_bill_has_posted_can_be_found_without_reading_every_expense(): void
    {
        $this->assertContains(['tenant_id', 'recurring_expense_id'], $this->indexed('expenses'));
    }

    public function test_the_check_can_tell_an_indexed_column_from_one_that_is_not(): void
    {
        // The denominator: if `getIndexes` came back empty, both tests above
        // would be comparing against nothing — and still be wrong, loudly.
        $this->assertNotEmpty($this->indexed('expenses'));
        $this->assertNotContains(['tenant_id', 'payee'], $this->indexed('expenses'));
    }
}
