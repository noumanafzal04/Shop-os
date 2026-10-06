<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Enums\RestaurantTicketStatus;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\DiningTable;
use App\Models\KitchenTicket;
use App\Models\RestaurantTicket;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\ServiceDay;
use App\Support\TabSummary;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * THE FLOOR, IN ONE LOOK.
 *
 * The floor screen used to be the table list and nothing else, which left two
 * things a restaurant has every night with nowhere to be seen:
 *
 *   a TAKEAWAY tab. "+ Takeaway" opened one and walked into it; step back to
 *   the floor and it was gone — no table to stand for it, so no tile. The only
 *   way back to an unpaid takeaway order was the browser's back button.
 *
 *   a tab LEFT OPEN. A table nobody settled last night is "occupied" this
 *   morning, indistinguishable from one sat five minutes ago.
 *
 * So this is one payload — the tables, the takeaway tabs, and how many of
 * either were opened in a service that is over — polled once, drawn as-is.
 */
class FloorController extends Controller
{
    public function show(): JsonResponse
    {
        $branchId = app(BranchContext::class)->scopeId();
        $began = ServiceDay::began();

        $tables = DiningTable::query()
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->where('is_active', true)
            ->with(['openTicket' => fn ($q) => $q->with(TabSummary::NEEDS)])
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get();

        $takeaway = $this->openTabs($branchId)
            ->whereNull('dining_table_id')
            ->with(TabSummary::NEEDS)
            ->orderBy('opened_at')
            ->get();

        return ApiResponse::ok([
            'tables' => $tables->map(fn (DiningTable $t) => [
                'id' => $t->id,
                'name' => $t->name,
                'area' => $t->area,
                'seats' => $t->seats,
                'sort_order' => $t->sort_order,
                'is_active' => (bool) $t->is_active,
                'open_ticket' => $t->openTicket === null ? null : TabSummary::of($t->openTicket, $began),
            ])->all(),
            'takeaway' => $takeaway->map(fn (RestaurantTicket $t) => TabSummary::of($t, $began))->all(),
            'service_began' => $began->toJSON(),
            'server_time' => now()->toJSON(),
        ]);
    }

    /**
     * CLOSE WHAT AN EARLIER SERVICE LEFT OPEN, IN ONE GO.
     *
     * A tab nobody settled is cancelled one at a time today: open it, Cancel
     * tab, confirm, back to the floor. After a busy night with a dozen
     * walk-outs and test tabs that is the first quarter of an hour of the
     * morning, and it is why they are usually left.
     *
     * The fences are `cancel`'s own, kept exactly:
     *
     *   a tab with anything PAID on it is never touched. Part of that meal is
     *   a sale; cancelling the rest is a decision about money owed, and it is
     *   made at the tab, by a person, with the bill in front of them. It is
     *   counted back as `kept` so the screen can say so.
     *
     *   only tabs from BEFORE this service. Tonight's tables are never in
     *   reach of this button, whatever is sent.
     *
     * Its authority is `tables.serve_any` — these are other waiters' tabs.
     */
    public function closeOlder(): JsonResponse
    {
        $branchId = app(BranchContext::class)->scopeId();
        $began = ServiceDay::began();

        [$closed, $kept] = DB::transaction(function () use ($branchId, $began): array {
            $tabs = $this->openTabs($branchId)
                ->where('opened_at', '<', $began)
                ->lockForUpdate()
                ->get();

            $closed = 0;
            $kept = 0;
            $value = 0.0;

            foreach ($tabs as $tab) {
                if ($tab->items()->whereNotNull('sale_id')->exists()) {
                    $kept++;

                    continue;
                }

                $value += (float) $tab->items()->whereNull('voided_at')->sum('line_total');

                $tab->items()->whereNull('voided_at')->update([
                    'voided_at' => now(),
                    'kot_status' => 'void',
                    'void_reason' => 'Left open from an earlier service',
                ]);

                KitchenTicket::query()
                    ->where('ticket_id', $tab->id)
                    ->whereIn('status', KitchenTicket::ACTIVE)
                    ->update(['status' => 'void']);

                $tab->forceFill([
                    'status' => RestaurantTicketStatus::Void,
                    'closed_at' => now(),
                ])->save();

                $closed++;
            }

            if ($closed > 0) {
                // ONE line on the trail, with what it was worth. "Who closed
                // nine tabs on Tuesday morning, and how much food was on them"
                // is the question an owner asks, and nine rows of tab ids do
                // not answer it.
                AuditLog::query()->create([
                    'user_id' => auth()->id(),
                    'tenant_id' => app(TenantContext::class)->id(),
                    'event' => 'cleared',
                    'auditable_type' => RestaurantTicket::class,
                    'auditable_id' => null,
                    'old_values' => null,
                    'new_values' => [
                        'tabs' => $closed,
                        'unpaid_value' => round($value, 2),
                        'which' => 'left open from an earlier service',
                    ],
                    'ip_address' => request()?->ip(),
                ]);
            }

            return [$closed, $kept];
        });

        $message = match (true) {
            $closed === 0 && $kept === 0 => 'Nothing was left open.',
            $closed === 0 => 'Nothing closed — what is left has payments on it and must be settled.',
            default => ($closed === 1 ? '1 tab closed.' : "{$closed} tabs closed.")
                .($kept > 0 ? " {$kept} part-paid left for you to settle." : ''),
        };

        return ApiResponse::ok(['closed' => $closed, 'kept' => $kept], $message);
    }

    /**
     * Tabs still open on the floor being worked.
     *
     * Counter orders are the KITCHEN's — rung at the till and paid before the
     * kitchen saw them. They are open only so their docket stays on the pass,
     * and are never a tab anybody can add to, settle, or cancel from here.
     */
    private function openTabs(?string $branchId): Builder
    {
        return RestaurantTicket::query()
            ->when($branchId, fn (Builder $q) => $q->where('branch_id', $branchId))
            ->where('from_counter', false)
            ->where('status', RestaurantTicketStatus::Open->value);
    }
}
