<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Demo\KeepDemoShopAction;
use App\Enums\SaleStatus;
use App\Enums\UserRole;
use App\Http\Controllers\Controller;
use App\Http\Resources\TenantResource;
use App\Models\Tenant;
use App\Support\ApiResponse;
use App\Support\BusinessTypes;
use App\Support\Takings;
use Illuminate\Database\Query\Builder as Query;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * THE SHOPS PEOPLE ARE TRYING RIGHT NOW — and the admin's own way to keep one.
 *
 * ── What was missing ───────────────────────────────────────────────────
 *
 * The console counted demos ("Trying it 8") and could do nothing else with
 * them. A demo reached an admin only if its visitor pressed "Keep this shop"
 * and filled the form in; until then it was a number. Somebody from the
 * platform sitting beside a shopkeeper who had just said yes had no button to
 * press — see KeepDemoShopAction.
 *
 * ── What the list is for ───────────────────────────────────────────────
 *
 * Finding WHICH one. A demo has a generated name and an anonymous owner, so
 * the row says the three things that tell them apart: the name on its own
 * header ("Mart Demo K7QP"), how long ago it was opened, and what has been
 * done in it — how much is on the shelf, how many sales were rung. A demo
 * with eleven sales in it is somebody deciding; a demo with none is somebody
 * who looked.
 *
 * Counted straight from the tables, not through the models: a product and a
 * sale are fenced to the shop in context, and there is no shop in context here.
 */
class DemoShopController extends Controller
{
    public function index(): JsonResponse
    {
        $counted = array_map(fn (SaleStatus $status): string => $status->value, Takings::COUNTED);
        $sales = fn (): Query => DB::table('sales')
            ->whereColumn('sales.tenant_id', 'tenants.id')
            ->whereNull('sales.deleted_at')
            // A practice till is not trade, in a demo as anywhere.
            ->where('sales.is_training', false)
            ->whereIn('sales.status', $counted);

        $demos = Tenant::query()
            ->demo()
            ->select('tenants.*')
            ->selectSub(
                DB::table('products')
                    ->whereColumn('products.tenant_id', 'tenants.id')
                    ->whereNull('products.deleted_at')
                    ->selectRaw('count(*)'),
                'products_count',
            )
            ->selectSub($sales()->selectRaw('count(*)'), 'sales_count')
            ->selectSub($sales()->selectRaw('coalesce(sum(total), 0)'), 'sales_total')
            ->selectSub($sales()->selectRaw('max(sold_at)'), 'last_sale_at')
            ->with(['shopRequests' => fn ($q) => $q->pending()])
            // Newest first: the one somebody opened ten minutes ago, across
            // the counter, is the one being looked for.
            ->orderByDesc('tenants.created_at')
            ->stably()->paginate(25);

        $demos->through(function (Tenant $demo): array {
            $asked = $demo->shopRequests->first();

            return [
                'id' => $demo->id,
                'business_name' => $demo->business_name,
                'business_type' => $demo->business_type,
                'business_type_label' => $demo->business_type === null
                    ? null
                    : (BusinessTypes::get($demo->business_type)['label'] ?? Str::headline($demo->business_type)),
                'created_at' => $demo->created_at?->toIso8601String(),
                'demo_expires_at' => $demo->demo_expires_at?->toIso8601String(),
                // Past its day and not yet cleared away. It can still be kept —
                // the clearing is a job that runs on a timer, not a wall.
                'ended' => $demo->demoHasEnded(),
                'products_count' => (int) $demo->getAttribute('products_count'),
                'sales_count' => (int) $demo->getAttribute('sales_count'),
                'sales_total' => round((float) $demo->getAttribute('sales_total'), 2),
                'last_sale_at' => $demo->getAttribute('last_sale_at') === null
                    ? null
                    : Carbon::parse($demo->getAttribute('last_sale_at'))->toIso8601String(),
                // Whoever pressed "Keep this shop" and is waiting. Their own
                // words for who they are, so the dialog can start from them.
                'request' => $asked === null ? null : [
                    'id' => $asked->id,
                    'contact_name' => $asked->contact_name,
                    'contact_email' => $asked->contact_email,
                    'contact_phone' => $asked->contact_phone,
                    'requested_at' => $asked->requested_at?->toIso8601String(),
                ],
            ];
        });

        return ApiResponse::paginated($demos);
    }

    /**
     * Keep a demo as a real shop, with the sign-in its owner will use.
     *
     * The same four things "Keep this shop" asks its owner — a name, an email
     * that becomes the sign-in, a phone if there is one, a password — and, if
     * the admin knows it, what the business is called.
     */
    public function keep(Request $request, string $tenant, KeepDemoShopAction $keep): JsonResponse
    {
        // Demos only. A real shop's id here is a 404, not a second kind of edit.
        $demo = Tenant::query()->demo()->findOrFail($tenant);

        $owner = $demo->users()->where('role', UserRole::ShopOwner)->oldest()->firstOrFail();

        $data = $request->validate([
            'owner_name' => ['required', 'string', 'max:120'],
            // Unique across users, because it becomes this owner's sign-in —
            // ignoring the throwaway address the demo was opened with, and the
            // one they typed themselves if they had already asked to stay.
            'owner_email' => [
                'required', 'email', 'max:190',
                Rule::unique('users', 'email')->ignore($owner->id),
            ],
            'owner_phone' => ['nullable', 'string', 'max:40'],
            'password' => ['required', 'string', Password::min(8)],
            // The same rule every shop's name is held to: no two alike.
            'business_name' => [
                'nullable', 'string', 'max:255',
                Rule::unique('tenants', 'business_name')->ignore($demo->id)->whereNull('deleted_at'),
            ],
        ], [
            'owner_email.unique' => 'Somebody already signs in with that email. Use another, or find their shop in the tenant list.',
            'business_name.unique' => 'There is already a shop called that.',
        ]);

        $kept = $keep->execute($request->user(), $demo, $data);

        return ApiResponse::ok(
            new TenantResource($kept->load(['city', 'plan', 'users'])),
            'It is a real shop now. Give it a plan, and tell the owner their sign-in.',
        );
    }
}
