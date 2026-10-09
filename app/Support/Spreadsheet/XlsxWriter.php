<?php

namespace App\Support\Spreadsheet;

/**
 * Writes the small workbooks this product hands out: a catalogue template, an
 * export of the shelf.
 *
 * What it can do is what a shopkeeper filling in a sheet needs and no more:
 * a bold header row that stays put when the sheet scrolls, columns wide enough
 * to read, a column kept as TEXT (so a barcode keeps its leading zero and does
 * not become 8.96E+12), a drop-down in a column, and a sheet of lists the
 * drop-downs read from that the shopkeeper never has to see.
 *
 * Every cell is written as an inline string or a number. No shared-string
 * table, no formulas, no dates — the fewer moving parts in the file, the fewer
 * programs that open it differently.
 */
final class XlsxWriter
{
    /** Cell styles, as indexes into `cellXfs` in styles(). */
    public const PLAIN = 0;

    public const HEADER = 1;

    public const TEXT = 2;

    public const REQUIRED = 3;

    /** @var array<int, array<string, mixed>> */
    private array $sheets = [];

    /**
     * @param  array<int, array<int, string|int|float|null>>  $rows  the first row is the header
     * @param  array{
     *   widths?: array<int, int|float>,
     *   text?: int[],
     *   required?: int[],
     *   lists?: array<int, array{column:int, source:string|string[], strict?:bool, prompt?:string}>,
     *   hidden?: bool,
     *   header?: bool,
     *   rowsOfLists?: int,
     * }  $options
     */
    public function sheet(string $name, array $rows, array $options = []): self
    {
        $this->sheets[] = ['name' => $name, 'rows' => $rows] + $options;

        return $this;
    }

    public function bytes(): string
    {
        $files = [
            '[Content_Types].xml' => $this->contentTypes(),
            '_rels/.rels' => self::XML_HEAD
                .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                .'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                .'</Relationships>',
            'xl/workbook.xml' => $this->workbook(),
            'xl/_rels/workbook.xml.rels' => $this->workbookRels(),
            'xl/styles.xml' => self::styles(),
        ];

        foreach ($this->sheets as $i => $sheet) {
            $files['xl/worksheets/sheet'.($i + 1).'.xml'] = $this->worksheet($sheet);
        }

        return Zip::write($files);
    }

    /** "A1"-style column letters: 0 → A, 27 → AB. */
    public static function column(int $index): string
    {
        $letters = '';
        for ($n = $index + 1; $n > 0; $n = intdiv($n - 1, 26)) {
            $letters = chr(65 + ($n - 1) % 26).$letters;
        }

        return $letters;
    }

    private const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'."\n";

    private const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

    private function contentTypes(): string
    {
        $sheets = '';
        foreach (array_keys($this->sheets) as $i) {
            $sheets .= '<Override PartName="/xl/worksheets/sheet'.($i + 1).'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }

        return self::XML_HEAD
            .'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            .'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            .'<Default Extension="xml" ContentType="application/xml"/>'
            .'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            .'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            .$sheets
            .'</Types>';
    }

    private function workbook(): string
    {
        $sheets = '';
        foreach ($this->sheets as $i => $sheet) {
            $sheets .= '<sheet name="'.self::esc(mb_substr($sheet['name'], 0, 31)).'" sheetId="'.($i + 1).'"'
                .(! empty($sheet['hidden']) ? ' state="hidden"' : '')
                .' r:id="rId'.($i + 1).'"/>';
        }

        return self::XML_HEAD
            .'<workbook xmlns="'.self::NS.'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            .'<sheets>'.$sheets.'</sheets>'
            .'</workbook>';
    }

    private function workbookRels(): string
    {
        $rels = '';
        foreach (array_keys($this->sheets) as $i) {
            $rels .= '<Relationship Id="rId'.($i + 1).'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'.($i + 1).'.xml"/>';
        }

        return self::XML_HEAD
            .'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            .$rels
            .'<Relationship Id="rId'.(count($this->sheets) + 1).'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            .'</Relationships>';
    }

    /**
     * Four looks: plain, a header, a header for a column that must be filled
     * in, and TEXT — the one that matters, because a column formatted as text
     * is the difference between a barcode and a rounded number.
     */
    private static function styles(): string
    {
        return self::XML_HEAD
            .'<styleSheet xmlns="'.self::NS.'">'
            .'<fonts count="2">'
            .'<font><sz val="11"/><name val="Calibri"/></font>'
            .'<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
            .'</fonts>'
            .'<fills count="4">'
            .'<fill><patternFill patternType="none"/></fill>'
            .'<fill><patternFill patternType="gray125"/></fill>'
            .'<fill><patternFill patternType="solid"><fgColor rgb="FF344054"/><bgColor indexed="64"/></patternFill></fill>'
            .'<fill><patternFill patternType="solid"><fgColor rgb="FFB42318"/><bgColor indexed="64"/></patternFill></fill>'
            .'</fills>'
            .'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            .'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            .'<cellXfs count="4">'
            .'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            .'<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
            .'<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
            .'<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
            .'</cellXfs>'
            .'<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            .'</styleSheet>';
    }

    /** @param  array<string, mixed>  $sheet */
    private function worksheet(array $sheet): string
    {
        /** @var array<int, array<int, string|int|float|null>> $rows */
        $rows = $sheet['rows'];
        $hasHeader = $sheet['header'] ?? true;
        $text = $sheet['text'] ?? [];
        $required = $sheet['required'] ?? [];
        $columns = max(1, ...array_map('count', $rows ?: [[]]));

        $xml = self::XML_HEAD.'<worksheet xmlns="'.self::NS.'">';

        // The header stays put while the rows scroll under it.
        $xml .= $hasHeader
            ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';

        $xml .= '<cols>';
        for ($c = 0; $c < $columns; $c++) {
            $width = $sheet['widths'][$c] ?? 18;
            // The style on the COLUMN is what a cell typed later inherits.
            $style = in_array($c, $text, true) ? ' style="'.self::TEXT.'"' : '';
            $xml .= '<col min="'.($c + 1).'" max="'.($c + 1).'" width="'.$width.'" customWidth="1"'.$style.'/>';
        }
        $xml .= '</cols>';

        $xml .= '<sheetData>';
        foreach (array_values($rows) as $r => $cells) {
            $xml .= '<row r="'.($r + 1).'">';
            foreach (array_values($cells) as $c => $value) {
                if ($value === null || $value === '') {
                    continue;
                }

                $ref = self::column($c).($r + 1);
                $style = match (true) {
                    $hasHeader && $r === 0 => in_array($c, $required, true) ? self::REQUIRED : self::HEADER,
                    in_array($c, $text, true) => self::TEXT,
                    default => self::PLAIN,
                };
                $s = $style !== self::PLAIN ? ' s="'.$style.'"' : '';

                // A number only where it is one AND the column is not text: a
                // SKU of 00417 in a text column must stay five characters.
                $xml .= (is_int($value) || is_float($value)) && $style !== self::TEXT
                    ? '<c r="'.$ref.'"'.$s.'><v>'.$value.'</v></c>'
                    : '<c r="'.$ref.'"'.$s.' t="inlineStr"><is><t xml:space="preserve">'.self::esc((string) $value).'</t></is></c>';
            }
            $xml .= '</row>';
        }
        $xml .= '</sheetData>';

        $lists = $sheet['lists'] ?? [];
        if ($lists !== []) {
            // Enough rows for a whole catalogue, not only the examples.
            $last = max(count($rows), (int) ($sheet['rowsOfLists'] ?? 3000));

            $xml .= '<dataValidations count="'.count($lists).'">';
            foreach ($lists as $list) {
                $col = self::column($list['column']);
                $strict = $list['strict'] ?? true;
                $source = is_array($list['source'])
                    ? '"'.implode(',', array_map(fn (string $s): string => str_replace(['"', ','], ['', ' '], $s), $list['source'])).'"'
                    : $list['source'];

                $xml .= '<dataValidation type="list" allowBlank="1" showErrorMessage="1"'
                    // A warning lets a value outside the list through after
                    // asking; a stop does not. A category the shop does not
                    // have yet is a thing a person may mean to type.
                    .($strict ? '' : ' errorStyle="warning"')
                    .' errorTitle="Not in the list" error="'.self::esc($list['prompt'] ?? 'Pick one from the list.').'"'
                    .' sqref="'.$col.'2:'.$col.$last.'">'
                    .'<formula1>'.self::esc($source).'</formula1>'
                    .'</dataValidation>';
            }
            $xml .= '</dataValidations>';
        }

        return $xml.'</worksheet>';
    }

    private static function esc(string $s): string
    {
        // Control characters are not legal in XML 1.0 and Excel refuses the
        // whole file for one of them.
        $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $s) ?? '';

        return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
