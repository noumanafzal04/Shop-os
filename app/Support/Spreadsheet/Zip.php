<?php

namespace App\Support\Spreadsheet;

use RuntimeException;

/**
 * Just enough of the zip format to open and write an .xlsx.
 *
 * ── Why this is here and a library is not ───────────────────────────────
 *
 * An .xlsx is a zip of XML. The usual way to read one is PhpSpreadsheet, which
 * needs `ext-zip` and `ext-gd` on the server; neither is something Laravel
 * asks for, and this product is deployed by `git pull && composer install` on
 * a box nobody has listed the extensions of. A catalogue import that takes the
 * deploy down with it is a worse bug than no Excel support.
 *
 * So: zlib only (`gzinflate` / `gzdeflate`, compiled into every PHP that
 * Ubuntu ships), and only the two things a spreadsheet needs — read a named
 * entry, write a handful of entries. No encryption, no zip64, no spanning; a
 * file that needs any of them is refused, by name.
 */
final class Zip
{
    /** A sheet of 2,000 rows is a few megabytes. This is a ceiling against a bomb, not a budget. */
    private const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

    /** @var array<string, array{method:int, size:int, compressed:int, offset:int}> */
    private array $entries = [];

    private function __construct(private readonly string $bytes) {}

    public static function looksLikeOne(string $bytes): bool
    {
        return strncmp($bytes, "PK\x03\x04", 4) === 0;
    }

    public static function available(): bool
    {
        return function_exists('gzinflate') && function_exists('gzdeflate');
    }

    public static function open(string $bytes): self
    {
        $zip = new self($bytes);

        // The directory is at the END, behind a comment of up to 65,535 bytes.
        $tail = substr($bytes, -65_557);
        $at = strrpos($tail, "PK\x05\x06");
        if ($at === false) {
            throw new RuntimeException('This is not a complete .xlsx file.');
        }

        $end = unpack('vdisk/vstart/vhere/vtotal/Vsize/Voffset', substr($tail, $at + 4, 16));
        if ($end === false || $end['offset'] === 0xFFFFFFFF) {
            throw new RuntimeException('This .xlsx is larger than this import can read.');
        }

        $p = $end['offset'];
        for ($i = 0; $i < $end['total']; $i++) {
            if (substr($bytes, $p, 4) !== "PK\x01\x02") {
                throw new RuntimeException('This .xlsx is damaged.');
            }

            $h = unpack(
                'vmade/vneed/vflags/vmethod/vtime/vdate/Vcrc/Vcompressed/Vsize/vname/vextra/vcomment/vdisk/vinternal/Vexternal/Voffset',
                substr($bytes, $p + 4, 42),
            );
            if ($h === false) {
                throw new RuntimeException('This .xlsx is damaged.');
            }

            $name = substr($bytes, $p + 46, $h['name']);
            $zip->entries[$name] = [
                'method' => $h['method'],
                'size' => $h['size'],
                'compressed' => $h['compressed'],
                'offset' => $h['offset'],
            ];

            $p += 46 + $h['name'] + $h['extra'] + $h['comment'];
        }

        return $zip;
    }

    public function has(string $name): bool
    {
        return isset($this->entries[$name]);
    }

    /** The entry's contents, or null when the file has no such entry. */
    public function get(string $name): ?string
    {
        $e = $this->entries[$name] ?? null;
        if ($e === null) {
            return null;
        }

        if ($e['size'] > self::MAX_ENTRY_BYTES) {
            throw new RuntimeException('This .xlsx is larger than this import can read.');
        }

        // The local header repeats the name and carries its OWN extra field,
        // whose length need not match the directory's.
        $local = unpack('vname/vextra', substr($this->bytes, $e['offset'] + 26, 4));
        if ($local === false || substr($this->bytes, $e['offset'], 4) !== "PK\x03\x04") {
            throw new RuntimeException('This .xlsx is damaged.');
        }

        $data = substr($this->bytes, $e['offset'] + 30 + $local['name'] + $local['extra'], $e['compressed']);

        if ($e['method'] === 0) {
            return $data;
        }
        if ($e['method'] !== 8) {
            throw new RuntimeException('This .xlsx is compressed in a way this import cannot read.');
        }

        $out = @gzinflate($data, self::MAX_ENTRY_BYTES);
        if ($out === false) {
            throw new RuntimeException('This .xlsx is damaged.');
        }

        return $out;
    }

    /**
     * @param  array<string, string|resource>  $files  path => contents
     */
    public static function write(array $files): string
    {
        $out = fopen('php://temp', 'w+b');
        try {
            self::writeTo($out, $files);
            rewind($out);

            return (string) stream_get_contents($out);
        } finally {
            fclose($out);
        }
    }

    /**
     * The zip, written into `$out` as it goes (#GS4). An entry may be a STREAM
     * — the sheet of a 20,000-item shelf is spooled to disk, never held as one
     * string — and is packed a megabyte at a time. Each entry's header carries
     * its checksum and size, known only once it is packed, so room is left for
     * the header and it is written over that room afterwards: `$out` must be
     * seekable.
     *
     * @param  resource  $out
     * @param  array<string, string|resource>  $files  path => contents
     */
    public static function writeTo($out, array $files): void
    {
        $start = (int) ftell($out);
        $directory = '';

        foreach ($files as $name => $contents) {
            $offset = (int) ftell($out) - $start;

            if (is_string($contents)) {
                $packed = (string) gzdeflate($contents, 6);
                $common = self::common(crc32($contents), strlen($packed), strlen($contents), $name);
                fwrite($out, "PK\x03\x04".$common.$name.$packed);
            } else {
                $room = (int) ftell($out);
                fwrite($out, str_repeat("\0", 30 + strlen($name)));

                $crc = hash_init('crc32b');
                $deflate = deflate_init(ZLIB_ENCODING_RAW, ['level' => 6]);
                $size = 0;
                $packedSize = 0;
                rewind($contents);
                while (($chunk = fread($contents, 1 << 20)) !== false && $chunk !== '') {
                    $size += strlen($chunk);
                    hash_update($crc, $chunk);
                    $packedSize += (int) fwrite($out, (string) deflate_add($deflate, $chunk, ZLIB_NO_FLUSH));
                }
                $packedSize += (int) fwrite($out, (string) deflate_add($deflate, '', ZLIB_FINISH));

                $common = self::common((int) hexdec(hash_final($crc)), $packedSize, $size, $name);
                $end = (int) ftell($out);
                fseek($out, $room);
                fwrite($out, "PK\x03\x04".$common.$name);
                fseek($out, $end);
            }

            $directory .= "PK\x01\x02".pack('v', 20).$common.pack('vvvVV', 0, 0, 0, 0, $offset).$name;
        }

        $body = (int) ftell($out) - $start;
        fwrite($out, $directory."PK\x05\x06".pack('vvvvVVv', 0, 0, count($files), count($files), strlen($directory), $body, 0));
    }

    /** What an entry's local header and its directory line share. */
    private static function common(int $crc, int $packed, int $size, string $name): string
    {
        // version 2.0, no flags, deflate, a fixed timestamp (1 Jan 2026) so
        // the same template is the same bytes.
        return pack('vvvvvVVVvv', 20, 0, 8, 0, 0x5C21, $crc, $packed, $size, strlen($name), 0);
    }
}
