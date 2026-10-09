<?php

namespace Tests\Unit;

use App\Exceptions\DomainException;
use App\Support\Spreadsheet\Tabular;
use App\Support\Spreadsheet\XlsxReader;
use App\Support\Spreadsheet\XlsxWriter;
use App\Support\Spreadsheet\Zip;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * The file a shopkeeper uploads, read as they see it.
 *
 * `tests/fixtures/import/excel-made.xlsx` was written by a spreadsheet library
 * that is not this one (openpyxl), on purpose: a reader tested only against its
 * own writer agrees with itself and proves nothing about Excel.
 */
class SpreadsheetTest extends TestCase
{
    private function fixture(): string
    {
        return (string) file_get_contents(__DIR__.'/../fixtures/import/excel-made.xlsx');
    }

    public function test_a_workbook_made_elsewhere_is_read_as_a_person_sees_it(): void
    {
        $rows = XlsxReader::rows($this->fixture(), 'Products');

        $this->assertSame(['Name', 'SKU', 'Barcode', 'Price', 'Stock Quantity', 'Expiry Date', 'Description', 'Is Active'], $rows[1]);
        // A thirteen-digit barcode is a number to Excel and must come back whole.
        $this->assertSame('8961234567890', $rows[2][2]);
        // A line break inside a cell is part of the cell.
        $this->assertSame("Crisp.\nPack of one.", $rows[2][6]);
        $this->assertSame('TRUE', $rows[2][7]);
    }

    public function test_an_empty_cell_does_not_slide_the_ones_after_it(): void
    {
        $rows = XlsxReader::rows($this->fixture(), 'Products');

        // No barcode and no stock on this row: the price is still under Price
        // and the description under Description.
        $this->assertSame('', $rows[3][2]);
        $this->assertSame('182.5', $rows[3][3]);
        $this->assertSame('By the kilo', $rows[3][6]);
    }

    public function test_text_keeps_its_leading_zero_and_bold_text_is_still_text(): void
    {
        $rows = XlsxReader::rows($this->fixture(), 'Products');

        $this->assertSame('00417', $rows[4][1]);
        $this->assertSame('Daily Milk 1L', $rows[4][0]);
    }

    public function test_a_row_keeps_the_number_it_has_in_the_sheet(): void
    {
        $rows = XlsxReader::rows($this->fixture(), 'Products');

        // Row 5 is empty in the sheet; the tea is on row 6, not row 5.
        $this->assertArrayNotHasKey(5, $rows);
        $this->assertSame('Urdu چائے', $rows[6][0]);
    }

    public function test_a_number_comes_back_as_it_was_typed(): void
    {
        $this->assertSame('8961234567890', XlsxReader::number('8.96123456789E12'));
        $this->assertSame('0.3', XlsxReader::number('0.30000000000000004'));
        $this->assertSame('182.5', XlsxReader::number('182.5'));
        $this->assertSame('50', XlsxReader::number('50'));
        $this->assertSame('', XlsxReader::number(''));
    }

    public function test_the_sheet_a_person_can_see_is_the_one_read(): void
    {
        // The fixture's FIRST sheet is a hidden list. Asked for nothing in
        // particular, the catalogue is still what comes back.
        $rows = XlsxReader::rows($this->fixture());

        $this->assertSame('Name', $rows[1][0]);
    }

    public function test_what_is_written_can_be_read_back(): void
    {
        $bytes = (new XlsxWriter)
            ->sheet('Products', [
                ['Name', 'SKU', 'Price'],
                ['Tea & <Milk> "x"', '00417', 182.5],
                ['چائے', 'CHAI', 50],
            ], ['text' => [1], 'lists' => [['column' => 0, 'source' => ['Yes', 'No']]]])
            ->sheet('Lists', [['Category'], ['Dairy']], ['hidden' => true])
            ->bytes();

        $this->assertTrue(Zip::looksLikeOne($bytes));

        $rows = XlsxReader::rows($bytes, 'Products');
        $this->assertSame(['Tea & <Milk> "x"', '00417', '182.5'], $rows[2]);
        $this->assertSame(['چائے', 'CHAI', '50'], $rows[3]);
    }

    public function test_the_same_template_is_the_same_bytes(): void
    {
        $make = fn (): string => (new XlsxWriter)->sheet('Products', [['Name'], ['Soap']])->bytes();

        $this->assertSame($make(), $make());
    }

    public function test_half_a_file_is_said_to_be_half_a_file(): void
    {
        $this->expectException(RuntimeException::class);

        Zip::open(substr($this->fixture(), 0, 400));
    }

    // ── a file saved as CSV ──────────────────────────────────────────

    public function test_a_file_separated_by_semicolons_or_tabs(): void
    {
        $this->assertSame(['Sugar 1kg', 'SUG-1', '180'], Tabular::read("name;sku;price\nSugar 1kg;SUG-1;180\n", 100)['rows'][2]);
        $this->assertSame(['Sugar 1kg', 'SUG-1', '180'], Tabular::read("name\tsku\tprice\nSugar 1kg\tSUG-1\t180\n", 100)['rows'][2]);
    }

    public function test_a_comma_inside_a_description_does_not_decide_the_separator(): void
    {
        $read = Tabular::read("name;price;description\nSoap;120;\"Lemon, lime, and mint\"\n", 100);

        $this->assertSame(['name', 'price', 'description'], $read['header']);
        $this->assertSame('Lemon, lime, and mint', $read['rows'][2][2]);
    }

    public function test_a_line_break_inside_a_cell_is_one_row(): void
    {
        $read = Tabular::read("name,description\nSoap,\"Lemon.\nPack of one.\"\nSugar,Loose\n", 100);

        $this->assertCount(2, $read['rows']);
        $this->assertSame("Lemon.\nPack of one.", $read['rows'][2][1]);
        $this->assertSame('Sugar', $read['rows'][3][0]);
    }

    public function test_a_file_from_windows_excel_keeps_its_letters(): void
    {
        $bytes = "name,price\n".mb_convert_encoding('Café Crème', 'Windows-1252', 'UTF-8').",450\n";

        $this->assertSame('Café Crème', Tabular::read($bytes, 100)['rows'][2][0]);
    }

    public function test_excels_unicode_text_is_read(): void
    {
        $bytes = "\xFF\xFE".mb_convert_encoding("name\tprice\nچائے\t50\n", 'UTF-16LE', 'UTF-8');

        $read = Tabular::read($bytes, 100);
        $this->assertSame(['name', 'price'], $read['header']);
        $this->assertSame(['چائے', '50'], $read['rows'][2]);
    }

    public function test_the_marker_excel_writes_first_is_not_part_of_the_first_header(): void
    {
        $this->assertSame('name', Tabular::read("\xEF\xBB\xBFname,price\nSoap,120\n", 100)['header'][0]);
    }

    public function test_blank_lines_are_not_rows_and_do_not_renumber_the_ones_after(): void
    {
        $read = Tabular::read("name,price\nSoap,120\n,\nSugar,180\n", 100);

        $this->assertSame([2, 4], array_keys($read['rows']));
    }

    public function test_an_old_excel_file_is_named_for_what_it_is(): void
    {
        try {
            Tabular::read("\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1 rest of an .xls", 100);
            $this->fail('An .xls was read as text.');
        } catch (DomainException $e) {
            $this->assertStringContainsString('.xls', $e->getMessage());
        }
    }

    public function test_an_excel_upload_is_recognised_whatever_it_is_called(): void
    {
        $read = Tabular::read($this->fixture(), 100);

        $this->assertSame('xlsx', $read['kind']);
        $this->assertSame('Name', $read['header'][0]);
        $this->assertSame([2, 3, 4, 6], array_keys($read['rows']));
    }
}
