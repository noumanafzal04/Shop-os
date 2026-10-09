<?php

namespace App\Support\Import;

use App\Models\Category;

/**
 * A category, as a shopkeeper writes it in a sheet: "Grocery > Beverages".
 *
 * ── What this replaces ──────────────────────────────────────────────────
 *
 * `Category::firstOrCreate(['name' => $typed])`. Two faults in one line:
 *
 *   it took the FIRST category with that name, whoever its parent was — so
 *   "Accessories" under Electronics and "Accessories" under Hardware were the
 *   same shelf to an import, whichever the database happened to return;
 *
 *   and a name it did not find it CREATED. "Bevrages" became a new top-level
 *   category with twelve drinks in it, beside the real one, and the import
 *   reported twelve items created.
 *
 * So: a category is found by its path, or by its name where that name is on
 * one shelf only; a name on several shelves is asked about; and a name on none
 * is NEVER made here — the person importing is shown it and chooses.
 *
 * Every lookup is inside the current shop: `Category` is tenant-scoped, and no
 * id from a file is ever read.
 */
final class CategoryPaths
{
    public const SEPARATOR = ' > ';

    /** @var array<string, string> id => "Grocery > Beverages" */
    private array $paths = [];

    /** @var array<string, string[]> path, as compared => ids */
    private array $byPath = [];

    /** @var array<string, string[]> the last name alone, as compared => ids */
    private array $byName = [];

    /** @var array<string, array{parent: ?string, name: string}> */
    private array $nodes = [];

    public static function ofThisShop(): self
    {
        $self = new self;

        foreach (Category::query()->orderBy('sort_order')->orderBy('name')->get(['id', 'parent_id', 'name']) as $category) {
            $self->nodes[$category->id] = ['parent' => $category->parent_id, 'name' => (string) $category->name];
        }
        foreach (array_keys($self->nodes) as $id) {
            $self->index((string) $id);
        }

        return $self;
    }

    /** @return string[] every path in the shop, A to Z — what a drop-down offers */
    public function all(): array
    {
        $paths = array_values($this->paths);
        sort($paths, SORT_NATURAL | SORT_FLAG_CASE);

        return $paths;
    }

    public function pathOf(?string $id): ?string
    {
        return $id !== null ? ($this->paths[$id] ?? null) : null;
    }

    public function has(string $id): bool
    {
        return isset($this->paths[$id]);
    }

    /**
     * @return array{status: 'found', id: string}
     *                                            | array{status: 'ambiguous', candidates: string[]}
     *                                            | array{status: 'unknown', suggestion: ?array{id: string, path: string}}
     */
    public function resolve(string $typed): array
    {
        $key = self::key($typed);

        // The whole path, as written.
        if (isset($this->byPath[$key])) {
            return ['status' => 'found', 'id' => $this->byPath[$key][0]];
        }

        // The end of a path: a bare name, or "Beverages > Juices" for
        // "Grocery > Beverages > Juices".
        $ending = [];
        foreach ($this->byPath as $path => $ids) {
            if (str_ends_with($path, '>'.$key)) {
                array_push($ending, ...$ids);
            }
        }
        $ending = array_values(array_unique($ending));

        if (count($ending) === 1) {
            return ['status' => 'found', 'id' => $ending[0]];
        }
        if (count($ending) > 1) {
            return ['status' => 'ambiguous', 'candidates' => array_map(fn (string $id): string => $this->paths[$id], $ending)];
        }

        return ['status' => 'unknown', 'suggestion' => $this->nearest($key)];
    }

    /**
     * Make the path, parents first, reusing whatever part of it exists.
     *
     * Only ever called because somebody was shown the name and chose "create".
     */
    public function create(string $typed): string
    {
        $parent = null;
        $id = null;

        foreach (self::segments($typed) as $name) {
            $id = null;
            foreach ($this->nodes as $candidate => $node) {
                if ($node['parent'] === $parent && self::key($node['name']) === self::key($name)) {
                    $id = (string) $candidate;
                    break;
                }
            }

            if ($id === null) {
                $id = (string) Category::query()->create(['name' => $name, 'parent_id' => $parent])->id;
                $this->nodes[$id] = ['parent' => $parent, 'name' => $name];
                $this->index($id);
            }

            $parent = $id;
        }

        return (string) $id;
    }

    /** How a path is compared: case, and the spacing around the arrows, are not part of it. */
    public static function key(string $typed): string
    {
        return implode('>', array_map(
            fn (string $s): string => mb_strtolower($s),
            self::segments($typed),
        ));
    }

    /** @return string[] */
    private static function segments(string $typed): array
    {
        $parts = array_map(
            fn (string $s): string => trim((string) preg_replace('/\s+/u', ' ', $s)),
            explode('>', $typed),
        );

        return array_values(array_filter($parts, fn (string $s): bool => $s !== ''));
    }

    private function index(string $id): void
    {
        $names = [];
        $seen = [];
        for ($at = $id; $at !== null && isset($this->nodes[$at]) && ! isset($seen[$at]); $at = $this->nodes[$at]['parent']) {
            $seen[$at] = true;
            array_unshift($names, $this->nodes[$at]['name']);
        }

        $path = implode(self::SEPARATOR, $names);
        $this->paths[$id] = $path;
        $this->byPath[self::key($path)][] = $id;
        $this->byName[self::key($this->nodes[$id]['name'])][] = $id;
    }

    /**
     * The category somebody most likely meant — or nothing, rather than a guess.
     *
     * Close means a slip of the fingers: one letter in four. "Bevrages" is
     * Beverages; "Drinks" is not.
     *
     * @return ?array{id: string, path: string}
     */
    private function nearest(string $key): ?array
    {
        $typed = self::lastOf($key);
        $best = null;
        $bestDistance = PHP_INT_MAX;

        foreach ($this->byName as $name => $ids) {
            $distance = levenshtein(mb_substr($typed, 0, 200), mb_substr($name, 0, 200));
            if ($distance < $bestDistance) {
                $bestDistance = $distance;
                $best = $ids[0];
            }
        }

        $allowed = max(1, intdiv(mb_strlen($typed), 4));

        return $best !== null && $bestDistance <= $allowed
            ? ['id' => $best, 'path' => $this->paths[$best]]
            : null;
    }

    private static function lastOf(string $key): string
    {
        $parts = explode('>', $key);

        return (string) end($parts);
    }
}
