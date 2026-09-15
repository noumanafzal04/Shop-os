<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Enums\RiderStatus;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Rider\StoreRiderRequest;
use App\Http\Requests\Rider\UpdateRiderRequest;
use App\Models\Order;
use App\Models\Rider;
use App\Models\RiderProfile;
use App\Services\RiderService;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * A shop's own delivery riders (Model A). Tenant-scoped CRUD; a rider with
 * open deliveries can be deactivated but not left mid-order silently — see
 * the active-orders guard on destroy.
 */
class RiderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $riders = Rider::query()
            ->when($request->has('is_active'), fn ($q) => $q->where('is_active', $request->boolean('is_active')))
            ->withCount([
                'orders as active_deliveries' => fn ($q) => $q->whereNotIn('status', ['completed', 'cancelled']),
                // What this rider is holding for us in cash. Delivered, paid in
                // cash, and not yet handed back — one query, no running total
                // to keep true. See the rider_settlements migration.
                'orders as unsettled_orders' => fn ($q) => $q
                    ->whereNotNull('delivered_at')->whereNull('rider_settlement_id')->where('payment_method', 'cod'),
            ])
            ->withSum([
                'orders as cash_in_hand' => fn ($q) => $q
                    ->whereNotNull('delivered_at')->whereNull('rider_settlement_id')->where('payment_method', 'cod'),
            ], 'total')
            ->with('riderProfile:id,rider_code,status,is_online,last_seen_at,vehicle_type,user_id')
            ->orderBy('name')
            ->get()
            ->map(fn (Rider $r) => $this->serialize($r));

        return ApiResponse::ok($riders);
    }

    /**
     * Add somebody who already has the app, by their rider id.
     *
     * The rider code is the whole point of that column: a shop cannot search
     * the platform's riders by name — that would be a directory of strangers'
     * phone numbers — so the rider reads their code off their own screen and
     * the shop types it. The same person cannot end up with two cards here;
     * the unique index says so and this says it in words first.
     */
    public function invite(Request $request, RiderService $riders): JsonResponse
    {
        $data = $request->validate([
            'rider_code' => ['required', 'string', 'max:16'],
        ]);

        $profile = RiderProfile::query()
            ->where('rider_code', strtoupper(trim($data['rider_code'])))
            ->first();

        if ($profile === null) {
            throw DomainException::unprocessable('No rider has that id.', 'RIDER_CODE_UNKNOWN');
        }
        if ($profile->status !== RiderStatus::Approved) {
            throw DomainException::unprocessable(
                'That rider is not approved yet ('.strtolower($profile->status->label()).').',
                'RIDER_NOT_APPROVED',
            );
        }

        $existing = Rider::query()->where('rider_profile_id', $profile->id)->first();
        if ($existing !== null) {
            throw DomainException::conflict('That rider is already on your list.', 'RIDER_ALREADY_LINKED');
        }

        $profile->loadMissing('user');
        $rider = Rider::query()->create([
            'rider_profile_id' => $profile->id,
            'name' => $profile->user?->name ?? $profile->rider_code,
            'phone' => $profile->user?->phone,
            'is_active' => true,
            'created_by' => auth()->id(),
        ]);

        return ApiResponse::created(
            $this->serialize($rider->load('riderProfile:id,rider_code,status,is_online,last_seen_at,vehicle_type,user_id')),
            "{$rider->name} added",
        );
    }

    /**
     * Take the cash back.
     *
     * Everything this rider is holding for THIS shop, in one write. A rider
     * carrying for three shops settles with each of them separately, which is
     * why this is tenant-scoped and the rider's own earnings screen is not.
     */
    public function settle(Request $request, string $id, RiderService $riders, TenantContext $context): JsonResponse
    {
        $data = $request->validate([
            'amount_paid' => ['nullable', 'numeric', 'min:0'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        $rider = Rider::query()->findOrFail($id);
        $shop = $context->get();
        abort_if($shop === null, 400);

        $settlement = $riders->settle(
            $shop, $rider, $request->user(),
            isset($data['amount_paid']) ? (float) $data['amount_paid'] : null,
            $data['note'] ?? null,
        );

        return ApiResponse::created($settlement, 'Cash settled');
    }

    /** What a rider is holding, order by order, before the shop settles it. */
    public function statement(string $id): JsonResponse
    {
        $rider = Rider::query()->findOrFail($id);

        $orders = Order::query()
            ->where('rider_id', $rider->id)
            ->whereNotNull('delivered_at')
            ->whereNull('rider_settlement_id')
            ->where('payment_method', 'cod')
            ->orderBy('delivered_at')
            ->get(['id', 'order_number', 'total', 'delivery_fee', 'delivered_at']);

        return ApiResponse::ok([
            'rider' => $this->serialize($rider->load('riderProfile:id,rider_code,status,is_online,last_seen_at,vehicle_type,user_id')),
            'orders' => $orders,
            'cash_in_hand' => round((float) $orders->sum(fn (Order $o) => (float) $o->total), 2),
            'rider_earned' => round((float) $orders->sum(fn (Order $o) => (float) $o->delivery_fee), 2),
        ]);
    }

    /**
     * One shop-side rider row. The profile is FLATTENED to four facts and no
     * more: a shop may know that its rider has the app and whether they are
     * holding a phone right now — not their CNIC, their other shops, or where
     * they are when they are not carrying this shop's order.
     */
    private function serialize(Rider $r): array
    {
        $p = $r->riderProfile;

        return [
            'id' => $r->id,
            'name' => $r->name,
            'phone' => $r->phone,
            'is_active' => $r->is_active,
            'active_deliveries' => $r->active_deliveries ?? 0,
            'unsettled_orders' => $r->unsettled_orders ?? 0,
            'cash_in_hand' => round((float) ($r->cash_in_hand ?? 0), 2),
            // IS SOMEBODY ACTUALLY HOLDING THE APP.
            //
            // This read `$p !== null`, which was the same question while a
            // profile only ever existed because a rider had made one. It is not
            // any more: every rider a shop adds now gets an id minted for them,
            // and an id nobody has claimed is a piece of paper in a drawer. A
            // shop whose riders never claim theirs must read exactly as it did
            // before any of this existed — no live pin, no handover code, the
            // panel driving the status — and it does, because every one of
            // those is gated on something only the app can set.
            'has_app' => $p !== null && ! $p->isUnclaimed(),
            // The id itself is shown either way. That is the point of minting
            // it: the shop reads it off this list and gives it to their rider.
            'rider_code' => $p?->rider_code,
            'app_status' => $p?->status->value,
            'is_online' => $p !== null && $p->isAvailable(),
            'vehicle_type' => $p?->vehicle_type,
        ];
    }

    /**
     * Add a rider — and hand the shop the id to give them.
     *
     * The id used to come from the rider: install the app, sign up, apply, be
     * approved, read `RDR-000123` off your own screen, tell the shop. Five
     * steps belonging to somebody who is not the shop, for something only the
     * shop wanted, and most shops never got past the first one.
     *
     * It is minted here now. The shop writes it down, the rider claims it in
     * the app (`POST /rider/claim`), and the direction of the whole flow
     * reverses without either side learning a new idea.
     */
    public function store(StoreRiderRequest $request, RiderService $riders): JsonResponse
    {
        $shop = app(TenantContext::class)->get();
        $data = $request->validated();

        $rider = DB::transaction(function () use ($data, $shop, $riders): Rider {
            $profile = $riders->mintForShop($shop, $data['name'], $data['phone'] ?? null);

            return Rider::query()->create($data + [
                'created_by' => auth()->id(),
                'rider_profile_id' => $profile->id,
            ]);
        });

        return ApiResponse::created(
            $this->serialize($rider->load('riderProfile:id,rider_code,status,is_online,last_seen_at,vehicle_type,user_id')),
            'Rider added',
        );
    }

    public function update(UpdateRiderRequest $request, string $id): JsonResponse
    {
        $rider = Rider::query()->findOrFail($id);
        $rider->update($request->validated());

        return ApiResponse::ok($rider, 'Rider updated');
    }

    public function destroy(string $id): JsonResponse
    {
        $rider = Rider::query()->findOrFail($id);
        $rider->delete(); // soft delete — past orders keep their rider snapshot via the nullable FK

        return ApiResponse::noContent('Rider removed');
    }
}
