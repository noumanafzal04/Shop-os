<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\Product;

/**
 * Shared modifier/add-on resolution for the order AND sale (POS) paths.
 * Validates chosen options against a product's groups (ownership + per-group
 * min/max) and returns [priceDelta, snapshot]. One implementation → online
 * checkout and the POS terminal price food identically.
 */
class ModifierResolver
{
    /**
     * @param  string[]  $optionIds
     * @return array{0: float, 1: array<array{group:string,name:string,price_delta:float}>}
     */
    public static function resolve(Product $product, array $optionIds): array
    {
        $groups = $product->modifierGroups()->with('options')->get();
        if ($groups->isEmpty()) {
            return [0.0, []];
        }

        $selected = collect($optionIds)->unique();
        $known = $groups->flatMap->options->keyBy('id');

        foreach ($selected as $oid) {
            if (! $known->has($oid)) {
                throw DomainException::unprocessable('An invalid option was selected.', 'MODIFIER_INVALID');
            }
        }

        $delta = 0.0;
        $snapshot = [];

        foreach ($groups as $group) {
            $chosen = $group->options->whereIn('id', $selected->all());
            $count = $chosen->count();

            if ($count < $group->min_select) {
                throw DomainException::unprocessable(
                    "Please choose at least {$group->min_select} for \"{$group->name}\".",
                    'MODIFIER_MIN',
                );
            }
            if ($group->max_select > 0 && $count > $group->max_select) {
                throw DomainException::unprocessable(
                    "Choose at most {$group->max_select} for \"{$group->name}\".",
                    'MODIFIER_MAX',
                );
            }

            foreach ($chosen as $opt) {
                $delta += (float) $opt->price_delta;
                $snapshot[] = ['group' => $group->name, 'name' => $opt->name, 'price_delta' => (float) $opt->price_delta];
            }
        }

        return [round($delta, 2), $snapshot];
    }
}
