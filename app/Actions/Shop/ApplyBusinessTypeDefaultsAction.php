<?php

namespace App\Actions\Shop;

use App\Models\Category;
use App\Models\ExpenseCategory;
use App\Models\IncomeCategory;
use App\Models\Tenant;
use App\Support\BusinessTypes;

/**
 * Seeds a tenant with its business-type template:
 *   - feature flags (matrix defaults)
 *   - default product/service categories
 *   - default expense categories
 *
 * Idempotent: templates only seed into an EMPTY tenant — re-running setup
 * or switching type never duplicates or overwrites the owner's edits.
 */
class ApplyBusinessTypeDefaultsAction
{
    public function execute(Tenant $tenant, string $businessType): void
    {
        $template = BusinessTypes::get($businessType);

        if ($template === null) {
            return;
        }

        $tenant->forceFill([
            'business_type' => $businessType,
            // defaultFeatures() (not the raw template) so admin-controlled
            // modules like Expense Manager get their baseline default.
            'features' => $tenant->features ?? BusinessTypes::defaultFeatures($businessType),
        ])->save();

        if (! Category::query()->where('tenant_id', $tenant->id)->exists()) {
            foreach ($template['product_categories'] as $i => $name) {
                Category::query()->create([
                    'tenant_id' => $tenant->id,
                    'name' => $name,
                    'sort_order' => $i,
                ]);
            }
        }

        if (! ExpenseCategory::query()->where('tenant_id', $tenant->id)->exists()) {
            foreach ($template['expense_categories'] as $name) {
                ExpenseCategory::query()->create([
                    'tenant_id' => $tenant->id,
                    'name' => $name,
                    'is_default' => true,
                ]);
            }
        }

        if (! IncomeCategory::query()->where('tenant_id', $tenant->id)->exists()) {
            foreach (BusinessTypes::defaultIncomeCategories() as $name) {
                IncomeCategory::query()->create([
                    'tenant_id' => $tenant->id,
                    'name' => $name,
                    'is_default' => true,
                ]);
            }
        }
    }
}
