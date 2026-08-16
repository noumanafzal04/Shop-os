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

        $tenant->forceFill(['business_type' => $businessType])->save();

        // The type PROPOSES a module set; it never overrules one already there.
        // On the create screen the admin sees this proposal and adjusts it
        // before anything is saved, so by the time a tenant has features they
        // are a decision someone made, not a default nobody looked at.
        if ($tenant->features === null) {
            $tenant->applyModules(
                // The sub-type refines the proposal: a restaurant keeps a store
                // room and a juice corner does not, and the shop already told us
                // which it is on the onboarding screen.
                BusinessTypes::defaultFeatures($businessType, $tenant->business_category),
                merge: false,
            );
        }

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
