<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Product;
use App\Models\Promotion;
use App\Models\TaxGroup;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\PlanLimits;
use App\Support\PosDelta;
use App\Support\PosProjection;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * What a till holds, and how it stays current.
 *
 * One shape, two entry points. Without cursors it is a first load; with them it
 * is everything that changed since. A first load is simply a delta from the
 * beginning of time, so the client has one code path.
 *
 * ── Why SIX projections and not just products ───────────────────────────
 *
 * A till that only learns about products goes quietly wrong. The shop renames a
 * category and the counter still shows the old one. A promotion created on
 * Monday never runs. The accountant corrects a tax group and every receipt
 * stays wrong until somebody reinstalls the app. Each of those is invisible
 * from the shop's side — the change WAS saved, it simply never travelled — and
 * an invisible failure is worse than a loud one.
 *
 * Each projection carries its own cursor and pages independently. One shared
 * cursor would make categories wait behind a 20,000-item catalog's twenty
 * requests, and there is no reason a rename should arrive last.
 *
 * Settings are the exception: sent WHOLE on every call. A dozen fields with no
 * id to page by, and half a settings object is a till pricing with the new tax
 * rate and the old rounding.
 */
class PosCatalogController extends Controller
{
    /**
     * Rows per page, per projection.
     *
     * A 20,000-item shop is twenty requests rather than one 6 MB response that
     * a slow connection drops halfway through and starts again.
     */
    private const PAGE = 1000;

    /**
     * The settings a till prices and prints with.
     *
     * An allow-list rather than everything: delivery radius, loyalty rates and
     * kitchen stations are not counter information, and every extra field is
     * one more thing sitting on a tablet that gets lent out.
     */
    private const TILL_SETTINGS = [
        'currency', 'currency_symbol', 'default_tax_rate', 'tax_inclusive',
        'cash_rounding', 'max_discount_percent', 'max_discount_amount',
        'receipt_width', 'invoice_header', 'invoice_footer', 'invoice_show_logo',
        'receipt_show_cashier', 'invoice_ntn', 'invoice_strn',
        'scale_barcode_enabled', 'scale_barcode_prefix', 'scale_barcode_mode',
        'pos_require_shift', 'pos_default_payment',
    ];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchContext $branch,
    ) {}

    /** Everything a till needs to open, plus the first page of every projection. */
    public function bootstrap(Request $request): JsonResponse
    {
        return ApiResponse::ok($this->pull($request) + [
            'branch_id' => $this->branch->id(),
        ]);
    }

    /** Everything that changed since the cursors. */
    public function delta(Request $request): JsonResponse
    {
        return ApiResponse::ok($this->pull($request));
    }

    /**
     * Every projection, each against its own cursor, plus the settings.
     *
     * Settings ride on the delta too, not only the bootstrap. Withholding them
     * until the next cold start is how a discount ceiling raised on Monday is
     * still not being enforced on Friday.
     */
    private function pull(Request $request): array
    {
        $cursor = static function (string $type) use ($request): ?string {
            $value = $request->query($type);

            return is_string($value) && $value !== '' ? $value : null;
        };

        $tenant = $this->tenant->get();

        return [
            'products' => $this->products($cursor('products')),
            'categories' => $this->categories($cursor('categories')),
            'promotions' => $this->promotions($cursor('promotions')),
            'tax_groups' => $this->taxGroups($cursor('tax_groups')),
            'customer_groups' => $this->customerGroups($cursor('customer_groups')),
            'customers' => $this->customers($cursor('customers')),

            'settings' => collect($tenant?->allSettings() ?? [])->only(self::TILL_SETTINGS),
            'offline_days' => $tenant === null ? null : PlanLimits::limit($tenant, 'offline_days'),
            // May this till sell with no server at all? The kill switch, and
            // it lives on the catalog because that is the one call a till makes
            // WHILE IT STILL HAS a connection — which is the only moment the
            // answer can change hands. Off by default: a shop earns offline
            // selling once shadow mode has proved the pricing mirror on its own
            // carts, and an admin turns it on.
            //
            // Never a reason to reject a queued sale. Turning this off stops
            // NEW offline sales; anything already rung syncs exactly as before.
            'offline_selling' => $tenant !== null && PlanLimits::limit($tenant, 'offline_selling') === 1,

            // The till's own clock cannot be trusted — a tablet three days slow
            // would file its sales into the wrong trading day. This is what it
            // measures its drift against.
            'server_time' => now()->toIso8601String(),
            // The SHOP's calendar, which is not the server's and not the
            // tablet's. A promotion that runs on Fridays, or between 6pm and
            // 9pm, is a statement about local time — and a till evaluating
            // that in UTC would start a Karachi shop's evening sale five hours
            // early and end it five hours early too.
            'timezone' => $tenant?->timezone ?: 'Asia/Karachi',
        ];
    }

    // ── One method per projection ───────────────────────────────────

    private function products(?string $cursor): array
    {
        $page = PosDelta::page(
            Product::query()->withTrashed()->with(PosProjection::RELATIONS),
            $cursor,
            self::PAGE,
        );

        $live = $page['rows']->filter(fn (Product $p): bool => $this->alive($p));
        // Stock for the whole page in one query rather than one per row.
        $stock = PosProjection::stockAt($this->branch->id(), $live->pluck('id'));

        return $this->shape($page, fn (Product $p): ?array => $this->alive($p)
            ? PosProjection::item($p, $stock)
            : null);
    }

    private function categories(?string $cursor): array
    {
        // Their own rows rather than denormalised onto every product: a rename
        // then costs one row instead of re-sending the whole catalog.
        $page = PosDelta::page(Category::query()->withTrashed(), $cursor, self::PAGE);

        return $this->shape($page, fn (Category $c): ?array => $this->alive($c)
            ? ['id' => $c->id, 'name' => $c->name, 'parent_id' => $c->parent_id, 'sort_order' => $c->sort_order]
            : null);
    }

    private function promotions(?string $cursor): array
    {
        $page = PosDelta::page(Promotion::query()->withTrashed(), $cursor, self::PAGE);

        return $this->shape($page, fn (Promotion $p): ?array => $this->alive($p)
            ? [
                'id' => $p->id,
                'name' => $p->name,
                // Sent rather than filtered out, because a promotion switched
                // OFF has to reach the till as an off promotion. Filtering it
                // from the list would leave the till holding yesterday's copy
                // and still applying it — the delta only carries what changed,
                // and "gone from the results" is how a tombstone looks too.
                'is_active' => (bool) $p->is_active,
                'type' => $p->type,
                'value' => (float) $p->value,
                'scope' => $p->scope,
                'category_id' => $p->category_id,
                'product_ids' => $p->product_ids,
                'min_spend' => $p->min_spend === null ? null : (float) $p->min_spend,
                'min_qty' => $p->min_qty === null ? null : (float) $p->min_qty,
                'max_discount' => $p->max_discount === null ? null : (float) $p->max_discount,
                // Windows travel as they are stored. The till compares them
                // against SERVER time plus its measured drift, never against
                // its own clock — a slow tablet would otherwise run a flash
                // sale that ended yesterday.
                'starts_on' => $p->starts_on?->toDateString(),
                'ends_on' => $p->ends_on?->toDateString(),
                'days_of_week' => $p->days_of_week,
                'start_time' => $p->start_time,
                'end_time' => $p->end_time,
                'priority' => (int) $p->priority,
                // Buy-X-get-Y. Meaningless on the other types and sent anyway,
                // because a till that cannot see them cannot tell a BOGO it
                // understands from one it does not — and guessing at a
                // promotion is how a receipt goes wrong offline.
                'buy_qty' => $p->buy_qty === null ? null : (float) $p->buy_qty,
                'get_qty' => $p->get_qty === null ? null : (float) $p->get_qty,
                'get_discount_pct' => $p->get_discount_pct === null ? null : (float) $p->get_discount_pct,
            ]
            : null);
    }

    private function taxGroups(?string $cursor): array
    {
        $page = PosDelta::page(TaxGroup::query()->withTrashed(), $cursor, self::PAGE);

        return $this->shape($page, fn (TaxGroup $g): ?array => $this->alive($g)
            ? ['id' => $g->id, 'name' => $g->name, 'rate' => (float) $g->rate]
            : null);
    }

    private function customerGroups(?string $cursor): array
    {
        // Pricing needs these: a group decides the price level and any standing
        // discount, so a cart cannot be priced without them.
        $page = PosDelta::page(CustomerGroup::query()->withTrashed(), $cursor, self::PAGE);

        return $this->shape($page, fn (CustomerGroup $g): ?array => $this->alive($g)
            ? [
                'id' => $g->id,
                'name' => $g->name,
                'price_level' => $g->price_level,
                'discount_percent' => $g->discount_percent === null ? null : (float) $g->discount_percent,
            ]
            : null);
    }

    private function customers(?string $cursor): array
    {
        $page = PosDelta::page(Customer::query()->withTrashed(), $cursor, self::PAGE);

        // Name, phone and group — and nothing else, ever. A balance, a ledger
        // or a purchase history in browser storage is a customer's private
        // business sitting on a tablet that gets lent out. The group is here
        // only because pricing cannot work without it.
        return $this->shape($page, fn (Customer $c): ?array => $c->deleted_at === null
            ? [
                'id' => $c->id,
                'name' => $c->name,
                'phone' => $c->phone,
                'customer_group_id' => $c->customer_group_id,
            ]
            : null);
    }

    // ── Shared shape ────────────────────────────────────────────────

    /**
     * Turn a page of rows into items, tombstoning whatever the projector
     * declines.
     *
     * A projector returning null means "the till may no longer use this", which
     * covers deletion AND being switched off — different things to a shopkeeper
     * and the same thing to a counter. Products are soft-deleted, so without a
     * tombstone a removed row simply stops matching the query and stays on
     * every device that already holds it, for good.
     *
     * @param  array{rows: Collection, cursor: ?string, has_more: bool}  $page
     */
    private function shape(array $page, callable $project): array
    {
        return [
            'items' => $page['rows']
                ->map(fn (Model $row): array => $project($row) ?? ['id' => $row->getKey(), 'deleted' => true])
                ->values()->all(),
            'cursor' => $page['cursor'],
            'has_more' => $page['has_more'],
        ];
    }

    /** Not deleted, and not switched off. */
    private function alive(Model $row): bool
    {
        return $row->deleted_at === null && (bool) ($row->is_active ?? true);
    }
}
