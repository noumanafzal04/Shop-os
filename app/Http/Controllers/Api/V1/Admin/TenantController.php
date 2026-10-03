<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Tenant\ActivateTenantAction;
use App\Actions\Tenant\AssignPlanAction;
use App\Actions\Tenant\CreateTenantAction;
use App\Actions\Tenant\DeleteTenantAction;
use App\Actions\Tenant\ResetTenantOwnerPasswordAction;
use App\Actions\Tenant\SuspendTenantAction;
use App\Actions\Tenant\UpdateTenantAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ExtendTenantLimitsRequest;
use App\Http\Requests\Admin\ResetTenantOwnerPasswordRequest;
use App\Http\Requests\Admin\StoreEntitlementRequest;
use App\Http\Requests\Admin\UpdateTenantModulesRequest;
use App\Http\Requests\Tenant\AssignPlanRequest;
use App\Http\Requests\Tenant\StoreTenantRequest;
use App\Http\Requests\Tenant\UpdateTenantRequest;
use App\Http\Resources\TenantResource;
use App\Http\Resources\UserResource;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\TenantEntitlement;
use App\Support\ApiResponse;
use App\Support\Modules;
use App\Support\PlanLimits;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TenantController extends Controller
{
    /**
     * List tenants — paginated, searchable, filterable.
     *
     * `payment_status` is the one an admin chasing money actually reaches for:
     * paid / grace / unpaid / suspended, mutually exclusive by construction
     * (see Tenant::scopePaymentStatus). `origin` is the one an admin chasing
     * NEW BUSINESS reaches for: demo / converted / direct, where "converted"
     * is somebody who tried a demo, pressed "Keep this shop" and was approved
     * (see Tenant::origin).
     *
     * ── Every axis is counted with the OTHERS applied but not its own ──────
     *
     * The same rule the marketplace facets follow. A count taken with its own
     * filter applied would read "Unpaid (3)" while showing three rows no
     * matter how many shops are actually behind, which is worse than no count:
     * it is a number that always agrees with the screen and never tells you
     * anything. `$scoped($except)` is the one place the filter set is written
     * down, so the rows and every count can never drift apart.
     */
    public function index(Request $request): JsonResponse
    {
        $status = $request->query('payment_status');

        if ($status !== null && ! in_array($status, Tenant::PAYMENT_STATUSES, true)) {
            return ApiResponse::error(
                'Unknown payment status: '.$status.'. Expected one of '.implode(', ', Tenant::PAYMENT_STATUSES).'.',
                422,
                code: 'UNKNOWN_PAYMENT_STATUS',
            );
        }

        $origin = $request->query('origin');

        if ($origin !== null && $origin !== '' && ! in_array($origin, Tenant::ORIGINS, true)) {
            return ApiResponse::error(
                'Unknown origin: '.$origin.'. Expected one of '.implode(', ', Tenant::ORIGINS).'.',
                422,
                code: 'UNKNOWN_ORIGIN',
            );
        }

        $setup = $request->query('setup');

        /**
         * Every filter, in one place, with one axis liftable.
         *
         * @param  string|null  $except  the axis being COUNTED, left out so the
         *                               count answers "how many if I clicked
         *                               this?" rather than "how many are on
         *                               screen?"
         */
        $scoped = fn (?string $except = null) => Tenant::query()
            ->when($request->query('search'), function ($q, $search): void {
                $q->where(function ($q) use ($search): void {
                    $q->where('business_name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%")
                        ->orWhere('phone', 'like', "%{$search}%");
                });
            })
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($request->query('city_id'), fn ($q, $cityId) => $q->where('city_id', $cityId))
            // "No plan yet" is the state every converted shop starts in, so it
            // has to be askable — and it cannot be spelled as an EMPTY
            // plan_id, because an empty query parameter is how the panel says
            // "no filter". Answered before the generic branch below, which
            // would otherwise look for a plan whose id is the word "none".
            ->when($request->query('plan_id') === 'none', fn ($q) => $q->whereNull('plan_id'))
            ->when(
                $request->query('plan_id') && $request->query('plan_id') !== 'none',
                fn ($q) => $q->where('plan_id', $request->query('plan_id')),
            )
            ->when($request->query('business_type'), fn ($q, $type) => $q->where('business_type', $type))
            ->when($setup === 'pending', fn ($q) => $q->where('setup_completed', false))
            ->when($setup === 'done', fn ($q) => $q->where('setup_completed', true))
            ->when($request->boolean('online_only'), fn ($q) => $q->where('online_shop_enabled', true))
            ->when($request->boolean('with_deleted'), fn ($q) => $q->withTrashed())
            ->when($except !== 'origin' && $origin, fn ($q) => $q->origin($origin))
            ->when($except !== 'payment_status' && $status, fn ($q) => $q->paymentStatus($status));

        /**
         * HOW BIG IS THIS SHOP — two subqueries, and worth them.
         *
         * The list could say what every business PAYS and not what any of
         * them IS. "Standard" tells an admin nothing about whether the shop
         * is one counter or four, which is the first thing they need when a
         * plan change or a support call comes in. Two `withCount`s per page
         * of fifteen is cheap; opening fifteen shops to find out is not.
         */
        $tenants = $this->sorted(
            $scoped()->with(['city', 'plan'])->withCount(['branches', 'users']),
            (string) $request->query('sort', 'newest'),
        )
            ->paginate(min((int) $request->query('per_page', 15), 100))
            ->withQueryString();

        // Counted against the SAME filters minus payment_status — a search for
        // "Karachi" should show how the Karachi shops break down, not the
        // whole platform.
        $counts = [];
        foreach (Tenant::PAYMENT_STATUSES as $bucket) {
            $counts[$bucket] = $scoped('payment_status')->paymentStatus($bucket)->count();
        }

        // "All" cannot be read off the paginator — once a bucket is selected
        // the paginator counts that bucket — and it is not the sum of the four
        // either, because a deleted business sits in none of them.
        $counts['all'] = $scoped('payment_status')->count();

        return ApiResponse::paginated(
            TenantResource::collection($tenants),
            meta: [
                'payment_counts' => $counts,
                'origin_counts' => $this->originCounts($scoped('origin')),
            ],
        );
    }

    /**
     * The three doors, counted in one query rather than three.
     *
     * Conditional sums rather than a GROUP BY because the answer must contain
     * a zero for a door nobody used — a missing key would leave the panel
     * drawing a chip with no number beside two that have one.
     *
     * @return array<string, int>
     */
    private function originCounts(Builder $query): array
    {
        // select(), never selectRaw(): selectRaw APPENDS to `select *`, and
        // MySQL's ONLY_FULL_GROUP_BY refuses an aggregate standing beside a
        // non-aggregated column. SQLite allows it, so the failure would only
        // ever appear in production.
        $row = $query
            ->select(DB::raw(implode(', ', [
                // Literal 1/0 rather than a bound boolean, matching
                // DashboardService::forPlatform — both engines store a
                // boolean column as 1/0 and neither needs a binding to say so.
                'SUM(CASE WHEN is_demo = 1 THEN 1 ELSE 0 END) as demo',
                'SUM(CASE WHEN is_demo = 0 AND converted_at IS NOT NULL THEN 1 ELSE 0 END) as converted',
                'SUM(CASE WHEN is_demo = 0 AND converted_at IS NULL THEN 1 ELSE 0 END) as direct',
                'COUNT(*) as all_of_them',
            ])))
            ->toBase()
            ->first();

        return [
            'demo' => (int) ($row->demo ?? 0),
            'converted' => (int) ($row->converted ?? 0),
            'direct' => (int) ($row->direct ?? 0),
            'all' => (int) ($row->all_of_them ?? 0),
        ];
    }

    /**
     * The orders worth offering, and nothing else.
     *
     * An unrecognised sort falls back to newest rather than being ignored —
     * ignoring it would order by whatever the database felt like, which is
     * stable enough in testing to look deliberate and unstable enough in
     * production to duplicate a row across two pages.
     */
    private function sorted(Builder $query, string $sort): Builder
    {
        return match ($sort) {
            'oldest' => $query->orderBy('created_at'),
            'name' => $query->orderBy('business_name'),
            // Whoever renews soonest first, with shops that owe nothing last —
            // a null end date is "nothing due", not "due at the dawn of time".
            'renewal' => $query->orderByRaw('subscription_ends_at IS NULL')->orderBy('subscription_ends_at'),
            // The newest owner on the platform, which is what "converted"
            // is asked about in the first place.
            'converted' => $query->orderByRaw('converted_at IS NULL')->orderByDesc('converted_at'),
            default => $query->orderByDesc('created_at'),
        };
    }

    public function store(StoreTenantRequest $request, CreateTenantAction $action): JsonResponse
    {
        $tenant = $action->execute($request->validated());

        return ApiResponse::created(new TenantResource($tenant));
    }

    public function show(string $id): JsonResponse
    {
        $tenant = Tenant::withTrashed()->with(['city', 'plan', 'users'])->findOrFail($id);

        return ApiResponse::ok(new TenantResource($tenant));
    }

    public function update(UpdateTenantRequest $request, string $id, UpdateTenantAction $action): JsonResponse
    {
        $tenant = $action->execute(Tenant::query()->findOrFail($id), $request->validated());

        return ApiResponse::ok(new TenantResource($tenant), 'Tenant updated');
    }

    public function destroy(string $id, DeleteTenantAction $action): JsonResponse
    {
        $action->execute(Tenant::query()->findOrFail($id));

        return ApiResponse::noContent('Tenant deleted');
    }

    /** The catalog of manageable modules — labels, groups and dependencies. */
    public function moduleCatalog(): JsonResponse
    {
        return ApiResponse::ok(Modules::catalog());
    }

    /**
     * Change which modules a tenant has. This is the only lever on a shop's
     * capability — no plan grants or revokes one, so nothing can undo what is
     * set here except an admin setting it again.
     */
    public function updateModules(UpdateTenantModulesRequest $request, string $id): JsonResponse
    {
        /** @var Tenant $tenant */
        $tenant = Tenant::query()->findOrFail($id);

        $tenant->applyModules(
            collect($request->validated('modules'))->only(Modules::keys())->all(),
        );

        return ApiResponse::ok(new TenantResource($tenant->fresh()->load('city', 'plan')), 'Modules updated');
    }

    /**
     * Set (or clear) a single tenant's limits. Sends a sparse map of
     * {limit_key: value|null}; null clears it, so the resource falls back to
     * its plan (products, storage) or its platform default (branches, staff,
     * lanes).
     *
     * This is the endpoint behind "give this shop a second branch" and "let
     * them hold 200 more products" alike — one place, whichever side of the
     * plan/tenant line the resource sits on.
     *
     * Two things here are load-bearing:
     *
     *  - `mode: add` treats the number as an INCREASE. Extending a
     *    1,000-product tenant by 100 means typing 100, not 1,100. The endpoint
     *    used to be set-only behind a button labelled "Extend", so typing the
     *    increase silently cut the ceiling to it.
     *
     *  - A ceiling can never land BELOW what the tenant already uses. A shop
     *    with 800 products whose limit is cut to 100 isn't warned — it just
     *    finds that nothing can be added any more, which surfaces as "the
     *    software is broken" days later. Downgrading to a level the tenant has
     *    already grown past is always a mistake; refuse it with the numbers.
     */
    public function extendLimits(ExtendTenantLimitsRequest $request, string $id): JsonResponse
    {
        /** @var Tenant $tenant */
        $tenant = Tenant::query()->findOrFail($id)->loadMissing('plan');

        $mode = $request->validated('mode') ?? 'set';
        $next = [];
        $applied = [];

        foreach ($request->validated('limits') as $key => $value) {
            if ($value === null) {
                $next[$key] = null; // clear → fall back to plan / default
                $applied[$key] = null;

                continue;
            }

            $current = PlanLimits::limit($tenant, $key);

            // Adding to "unlimited" is meaningless — there is no ceiling to
            // raise. Say so rather than quietly inventing one.
            if ($mode === 'add' && $current === null) {
                throw DomainException::unprocessable(
                    "{$key} is already unlimited for this tenant — there is nothing to extend.",
                    'ALREADY_UNLIMITED',
                );
            }

            $value = $mode === 'add' ? (int) $current + (int) $value : (int) $value;

            if ($value < 1) {
                throw DomainException::unprocessable(
                    "That would leave {$key} at {$value}. A limit has to be at least 1.",
                    'LIMIT_TOO_LOW',
                );
            }

            // The guard against a typo becoming an outage. It applies only to
            // things the shop OWNS: cutting a ceiling below 800 existing
            // products blocks every new one silently. A policy is the opposite
            // case — tightening the offline window while a tablet is five days
            // out is not a typo, it is what an owner does the moment a tablet
            // goes missing, and refusing it would refuse the remedy.
            $used = PlanLimits::usage($tenant, $key);
            if (PlanLimits::isCountable($key) && $value < $used) {
                $label = PlanLimits::REGISTRY[$key]['label'];
                throw DomainException::unprocessable(
                    "This shop already has {$used} {$label} — the limit can't be set to {$value}. "
                    ."Set it to {$used} or more, or remove the extra {$label} first.",
                    'LIMIT_BELOW_USAGE',
                );
            }

            $next[$key] = $value;
            $applied[$key] = $value;
        }

        $tenant->assignLimits($next);

        return ApiResponse::ok(
            new TenantResource($tenant->fresh()->load('city', 'plan')),
            'Limits updated',
            ['applied' => $applied],
        );
    }

    /**
     * CAPACITY BOUGHT OR GIVEN — the add-on and the temporary grant.
     *
     * Beside `extendLimits` and not inside it, because the two answer
     * different questions and only one of them can be invoiced.
     * `extendLimits` ASSIGNS the size of the organisation: this shop is a
     * three-branch business. This records that three more staff accounts
     * were sold at Rs 400, or given until the end of Ramzan — and that is a
     * line somebody can bill, expire and explain six months later.
     */
    public function storeEntitlement(StoreEntitlementRequest $request, string $id): JsonResponse
    {
        /** @var Tenant $tenant */
        $tenant = Tenant::query()->findOrFail($id);

        $data = $request->validated();

        $entitlement = TenantEntitlement::withoutTenancy()->create([
            'tenant_id' => $tenant->id,
            'limit_key' => $data['limit_key'],
            'quantity' => $data['quantity'],
            'unit_price' => $data['unit_price'] ?? null,
            'starts_on' => $data['starts_on'] ?? now()->toDateString(),
            'ends_on' => $data['ends_on'] ?? null,
            'note' => $data['note'] ?? null,
            'created_by' => $request->user()?->id,
        ]);

        $label = PlanLimits::REGISTRY[$data['limit_key']]['label'] ?? $data['limit_key'];

        return ApiResponse::created(
            $entitlement,
            "+{$entitlement->quantity} {$label} granted to {$tenant->business_name}.",
        );
    }

    /**
     * Every grant this shop has ever had, newest first.
     *
     * Expired ones included, and that is the point: a lapsed "+3 users
     * until December" is the answer to why the shop had thirteen in
     * November, and hiding it makes that month's invoice unexplainable.
     */
    public function entitlements(string $id): JsonResponse
    {
        $tenant = Tenant::query()->findOrFail($id);

        return ApiResponse::ok(
            TenantEntitlement::withoutTenancy()
                ->where('tenant_id', $tenant->id)
                ->orderByDesc('starts_on')
                ->orderByDesc('created_at')
                ->get()
                ->map(fn (TenantEntitlement $e) => $e->toArray() + [
                    'label' => PlanLimits::REGISTRY[$e->limit_key]['label'] ?? $e->limit_key,
                    'period_value' => $e->periodValue(),
                    // Said by the server, so the screen and an invoice run
                    // cannot disagree about whether a grant is live today.
                    'state' => $e->hasExpired() ? 'expired' : ($e->isPending() ? 'pending' : 'live'),
                ]),
        );
    }

    /**
     * END a grant. Not a delete — ending one tomorrow and erasing one that
     * has already been billed are different acts, and only the first is
     * ever what somebody means.
     */
    public function endEntitlement(string $id, string $entitlementId): JsonResponse
    {
        $tenant = Tenant::query()->findOrFail($id);

        /** @var TenantEntitlement $entitlement */
        $entitlement = TenantEntitlement::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->findOrFail($entitlementId);

        if ($entitlement->hasExpired()) {
            throw DomainException::conflict('That grant has already ended.', 'ENTITLEMENT_ENDED');
        }

        // Ends TODAY, inclusive — the shop keeps the capacity for the rest
        // of the day it is withdrawn, which is the difference between
        // tidying a record and taking three staff accounts away mid-shift.
        $entitlement->forceFill(['ends_on' => now()->toDateString()])->save();

        return ApiResponse::ok($entitlement->fresh(), 'Grant ends today.');
    }

    public function suspend(string $id, SuspendTenantAction $action): JsonResponse
    {
        $tenant = $action->execute(Tenant::query()->findOrFail($id));

        return ApiResponse::ok(new TenantResource($tenant), 'Tenant suspended — all sessions revoked');
    }

    public function activate(string $id, ActivateTenantAction $action): JsonResponse
    {
        $tenant = $action->execute(Tenant::query()->findOrFail($id));

        return ApiResponse::ok(new TenantResource($tenant), 'Tenant activated');
    }

    public function restore(string $id): JsonResponse
    {
        $tenant = Tenant::withTrashed()->findOrFail($id);

        if (! $tenant->trashed()) {
            return ApiResponse::error('This tenant is not deleted.', 409, code: 'TENANT_NOT_DELETED');
        }

        $tenant->restore();

        return ApiResponse::ok(new TenantResource($tenant), 'Tenant restored');
    }

    /**
     * Put a locked-out shop owner back into their own business.
     *
     * Returns who was reset, never the password that was set — see the action.
     */
    public function resetOwnerPassword(
        ResetTenantOwnerPasswordRequest $request,
        string $id,
        ResetTenantOwnerPasswordAction $action,
    ): JsonResponse {
        $owner = $action->execute(
            actor: $request->user(),
            tenant: Tenant::query()->findOrFail($id),
            password: $request->validated('password'),
            userId: $request->validated('user_id'),
        );

        return ApiResponse::ok(
            new UserResource($owner),
            "Password set for {$owner->name}. All of their sessions have been signed out.",
        );
    }

    /**
     * WHAT WOULD CHANGE — asked before anything does.
     *
     * Moving a shop between plans is the one admin action whose consequences
     * are invisible at the moment it is taken. The price difference an admin
     * can work out; what they cannot work out from a dropdown is that this
     * particular shop has six staff accounts and the plan they are about to
     * choose includes three.
     *
     * ── Nothing is refused, and nothing is deleted ──────────────────────
     *
     * A downgrade that leaves a shop over its new ceiling is allowed. It is
     * an ordinary commercial situation — a chain closing a branch next month,
     * a seasonal business shrinking its team — and the software's job is to
     * SAY SO, not to decide. Three answers follow from being told: remove the
     * excess, buy an add-on, or leave it. All three are the admin's.
     *
     * What must never happen is the fourth: the plan changes, seven staff
     * accounts stop working on Monday morning, and nobody was warned. That is
     * what this endpoint exists to prevent.
     *
     * It is a GET. It writes nothing, so an admin can flick through all four
     * plans and see each outcome before committing to any of them.
     */
    public function planChange(Request $request, string $id): JsonResponse
    {
        $tenant = Tenant::query()->with('plan')->findOrFail($id);
        $next = Plan::query()->findOrFail($request->query('plan_id'));

        $now = PlanLimits::snapshot($tenant);

        /**
         * The same shop, reading the other plan — in memory only.
         *
         * `setRelation` rather than a save-and-rollback: a preview that
         * touches the row would have the shop briefly, genuinely on the new
         * plan, and anything reading it in that instant (a sale, a sync, a
         * second admin) would see a change nobody has agreed to.
         */
        $hypothetical = clone $tenant;
        $hypothetical->plan_id = $next->id;
        $hypothetical->setRelation('plan', $next);
        $after = PlanLimits::snapshot($hypothetical);

        $byKey = collect($after)->keyBy('key');

        $rows = collect($now)->map(function (array $row) use ($byKey): array {
            $to = $byKey[$row['key']] ?? $row;

            return [
                'key' => $row['key'],
                'label' => $row['label'],
                'used' => $row['used'],
                'from' => $row['limit'],
                'to' => $to['limit'],
                // Positive only. A shop under its new ceiling has no excess,
                // and reporting a negative "excess" would read as a credit.
                'excess' => ($to['limit'] === null || $row['used'] <= $to['limit'])
                    ? 0
                    : $row['used'] - $to['limit'],
                'blocks' => $to['blocks'] ?? false,
            ];
        })->values();

        return ApiResponse::ok([
            'from' => ['id' => $tenant->plan?->id, 'name' => $tenant->plan?->name, 'price' => $tenant->plan?->price],
            'to' => ['id' => $next->id, 'name' => $next->name, 'price' => $next->price],
            // Signed, and per billing period rather than per month: a shop
            // moving from a monthly plan to an annual one is not "paying
            // 12x more".
            'price_difference' => round((float) $next->price - (float) ($tenant->plan?->price ?? 0), 2),
            'billing_period_months' => $next->billing_period_months,
            'rows' => $rows,
            /**
             * The rows an admin has to make a decision about, separated out
             * so the warning does not depend on anybody scanning a table of
             * eleven.
             *
             * `blocks` is the sharp half: being over the bills meter is a
             * conversation, being over the staff ceiling means nobody can
             * add the next account.
             */
            'excess' => $rows->filter(fn (array $r): bool => $r['excess'] > 0)->values(),
        ]);
    }

    public function assignPlan(AssignPlanRequest $request, string $id, AssignPlanAction $action): JsonResponse
    {
        $tenant = $action->execute(
            Tenant::query()->findOrFail($id),
            Plan::query()->findOrFail($request->validated('plan_id')),
            $request->validated('payment'),
            $request->validated('period'),
        );

        return ApiResponse::ok(new TenantResource($tenant), 'Plan assigned');
    }
}
