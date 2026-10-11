<?php

namespace App\Http\Resources;

use App\Models\Plan;
use App\Support\ModulePackages;
use App\Support\PlanLimits;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Plan
 */
class PlanResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'code' => $this->code,
            'description' => $this->description,
            'price' => $this->price,
            'billing_period_months' => $this->billing_period_months,
            'grace_period_days' => $this->grace_period_days,
            /**
             * WHAT THIS PLAN GIVES.
             *
             * Two kinds of number live here and they read null differently.
             *
             *   Billed usage — products, storage, orders a month. Null =
             *   UNLIMITED.
             *
             *   Organisation size — branches, staff, lanes. Null = THIS PLAN
             *   HAS NO OPINION, and the shop gets the platform default (1, 5,
             *   2). Never unlimited.
             *
             * `PlanLimits::baseline` is where that asymmetry is enforced and
             * explained; this block only reports it.
             */
            'limits' => [
                'products' => $this->max_products,
                'storage_mb' => $this->max_storage_mb,
                'orders_month' => $this->max_orders_month,
                'branches' => $this->max_branches,
                'warehouses' => $this->max_warehouses,
                'staff' => $this->max_staff,
                'registers' => $this->max_registers,
                // Whether a shop on this plan may sell with no server, and for
                // how many days. The plans screen has read these two since it
                // was built and was never sent them: every plan's card said
                // "Selling offline: No", including the three seeded WITH it.
                'offline_selling' => $this->max_offline_selling,
                'offline_days' => $this->max_offline_days,
                // How far back this plan lets a shop look. Null = no limit.
                'retention_months' => $this->retention_months,
            ],
            // Room past the included bills before anyone is called over. Read
            // by the same screen, and missing for the same reason.
            'grace_orders_month' => $this->grace_orders_month,
            /**
             * The defaults a shop lands on when this plan says nothing, so
             * the admin screen can print "1 branch (platform default)" rather
             * than an empty box that looks like a bug.
             */
            'defaults' => [
                'branches' => PlanLimits::REGISTRY['branches']['default'],
                'warehouses' => PlanLimits::REGISTRY['warehouses']['default'],
                'staff' => PlanLimits::REGISTRY['staff']['default'],
                'registers' => PlanLimits::REGISTRY['registers']['default'],
            ],
            // What the plan includes, and whether that is its own list or its
            // rung's. A starting point and a label: see ModulePackages.
            'modules' => ModulePackages::ofPlan($this->resource),
            'modules_own' => is_array($this->modules),
            'is_active' => $this->is_active,
            // A bespoke deal for one business rather than a rung on the ladder.
            'is_custom' => $this->is_custom,
            'tenants_count' => $this->whenCounted('tenants'),
        ];
    }
}
