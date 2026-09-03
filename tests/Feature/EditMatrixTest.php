<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\Bank;
use App\Models\BankCardOffer;
use App\Models\Banner;
use App\Models\Branch;
use App\Models\Category;
use App\Models\City;
use App\Models\Collection as ProductCollection;
use App\Models\Coupon;
use App\Models\CustomerGroup;
use App\Models\DiningTable;
use App\Models\FuelPump;
use App\Models\FuelTank;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Promotion;
use App\Models\Rider;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Modules;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * AN EDIT CHANGES WHAT IT NAMED, AND NOTHING ELSE.
 *
 * ── Why this file exists ────────────────────────────────────────────────
 *
 * A scanner asked two questions of every write endpoint in the product, and
 * both answers pointed at the same hole:
 *
 *   15 write routes that no test posts to at all — FOURTEEN of them PUT or PATCH
 *   19 optional fields that every test supplies — THIRTEEN on those same routes
 *
 * The suite creates things everywhere and edits them almost nowhere. And an
 * edit has a failure mode that a create does not: it can quietly change
 * something nobody asked it to. `PUT /collections/{id}` without `item_ids`
 * emptying the collection; `PATCH /riders/{id}` without `is_active` switching
 * the rider off; a customer group losing its members' discount because the
 * screen sent only the name.
 *
 * None of those would error. The endpoint answers 200 and the shop finds out
 * later — which is the same sentence as every other defect this codebase has
 * had this week.
 *
 * ── The invariant ───────────────────────────────────────────────────────
 *
 * For any update, all three must hold:
 *
 *   · the field it NAMED holds the new value
 *   · every other column is byte-identical
 *   · and it was not REFUSED for fields the caller had no reason to resend
 *
 * The third is a finding in its own right and is reported, not asserted away:
 * an endpoint that demands the whole record back to change one field is how a
 * screen ends up sending stale values over fresh ones.
 */
final class EditMatrixTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    /** @var array<int, string> */
    private array $wrong = [];

    /**
     * Columns that record the edit rather than the record.
     *
     * `updated_by` belongs here for the same reason as `updated_at`: an audit
     * stamp whose whole job is to move when somebody changes the row is not
     * something "nobody asked about".
     */
    private const THE_EDIT_ITSELF = ['updated_at', 'created_at', 'updated_by', 'created_by'];

    /** The denominator: how many edits were actually attempted. */
    private int $edits = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    public function test_an_edit_changes_what_it_named_and_leaves_the_rest_alone(): void
    {
        // RETAIL, because it is the trade that ships with the widest module set
        // — products, inventory, a till, delivery and reservations — so one shop
        // can reach every endpoint below.
        $this->openShop('retail');

        // ── A branch ────────────────────────────────────────────────
        $branch = $this->create('/api/v1/branches', [
            'name' => 'Saddar', 'code' => 'SDR',
            'address' => '2 Mall Road', 'phone' => '+923001112222',
        ]);
        $this->edit('a branch renamed', Branch::class, $branch,
            'put', "/api/v1/branches/{$branch}", ['name' => 'Saddar Two']);

        // ── A category, and the parent it must not lose ─────────────
        $parent = $this->create('/api/v1/categories', ['name' => 'Clothing']);
        $child = $this->create('/api/v1/categories', ['name' => 'Shirts', 'parent_id' => $parent]);
        $this->edit('a sub-category renamed', Category::class, $child,
            'patch', "/api/v1/categories/{$child}", ['name' => 'Formal Shirts']);

        // ── A customer group, and its members' discount ─────────────
        $group = $this->create('/api/v1/customer-groups', [
            'name' => 'Wholesale', 'price_level' => 'wholesale', 'discount_percent' => 12,
        ]);
        $this->edit('a customer group renamed', CustomerGroup::class, $group,
            'put', "/api/v1/customer-groups/{$group}", ['name' => 'Trade']);

        // ── A rider, who must not be switched off by a rename ───────
        $rider = $this->create('/api/v1/riders', ['name' => 'Bilal', 'phone' => '+923004445555']);
        $this->edit('a rider renamed', Rider::class, $rider,
            'patch', "/api/v1/riders/{$rider}", ['name' => 'Bilal Ahmed']);

        // ── A coupon, and the money it takes off ────────────────────
        $coupon = $this->create('/api/v1/coupons', [
            'code' => 'EID10', 'type' => 'percent', 'value' => 10, 'min_spend' => 2000,
        ]);
        $this->edit('a coupon renamed', Coupon::class, $coupon,
            'put', "/api/v1/coupons/{$coupon}", ['code' => 'EID15']);

        // ── A promotion ─────────────────────────────────────────────
        $promo = $this->create('/api/v1/promotions', [
            'name' => 'Weekend 5%', 'type' => 'percent', 'scope' => 'order',
            'value' => 5, 'min_spend' => 1000,
        ]);
        $this->edit('a promotion renamed', Promotion::class, $promo,
            'put', "/api/v1/promotions/{$promo}", ['name' => 'Weekend 5 percent']);

        // ── A FIXED promotion, repriced without resaying it is fixed ─
        //
        // The optional field every test supplies. `UpdatePromotionRequest`
        // reads `type` out of the INPUT with a default of `percent`, so a
        // partial edit that does not resend it is validated as a percentage —
        // and a percentage cannot exceed 100. A shop raising a Rs 50 discount
        // to Rs 5,000 is then refused, and the message names a field it was not
        // trying to change.
        $fixed = $this->create('/api/v1/promotions', [
            'name' => 'Rs 50 off', 'type' => 'fixed', 'scope' => 'order',
            'value' => 50, 'min_spend' => 1000,
        ]);
        $this->edit('a fixed promotion repriced', Promotion::class, $fixed,
            'put', "/api/v1/promotions/{$fixed}", ['value' => 5000]);

        // ── A bank, and the offer it funds ──────────────────────────
        //
        // A bank offer is money the SHOP hands back at the counter and claims
        // from the bank later, so an edit that quietly changes its ceiling or
        // its dates is a discount the shop pays for itself.
        $bank = $this->create('/api/v1/banks', ['name' => 'HBL', 'short_code' => 'HBL']);
        $this->edit('a bank renamed', Bank::class, $bank,
            'put', "/api/v1/banks/{$bank}", ['name' => 'Habib Bank']);

        $offer = $this->create('/api/v1/bank-offers', [
            'bank_id' => $bank, 'label' => 'Friday 10%', 'type' => 'percent',
            'value' => 10, 'max_discount' => 2000,
        ]);
        $this->edit('a bank offer relabelled', BankCardOffer::class, $offer,
            'put', "/api/v1/bank-offers/{$offer}", ['label' => 'Friday Ten']);

        // ── The OTHER VERB ──────────────────────────────────────────
        //
        // `apiResource` registers PUT and PATCH against the same method, and
        // the scanner listed both separately because nothing had posted to
        // either. They share a controller, so this is cheap — and it is not
        // free: a request class that reads `$this->method()` or a route model
        // binding that differs by verb would show up only here.
        $this->edit('a coupon\'s expiry moved by PATCH', Coupon::class, $coupon,
            'patch', "/api/v1/coupons/{$coupon}", ['usage_limit' => 25]);

        $this->edit('a promotion renamed by PATCH', Promotion::class, $promo,
            'patch', "/api/v1/promotions/{$promo}", ['min_spend' => 2500]);

        // ── A collection, whose CONTENTS are the thing at risk ──────
        $this->aCollectionKeepsItsItemsThroughARename();

        // THE DENOMINATOR. A matrix that quietly stopped attempting edits would
        // satisfy every assertion above.
        $this->assertGreaterThanOrEqual(12, $this->edits, 'the matrix shrank');

        $this->assertSame([], $this->wrong, "\n".implode("\n", $this->wrong)."\n");
    }

    /**
     * THE FORECOURT, WHERE AN EDIT MOVES A METER.
     *
     * `PUT /fuel/tanks/{id}` and `PUT /fuel/pumps/{id}` are two of the fifteen
     * routes no test posts to, and three of the nineteen always-supplied fields
     * are a tank's `capacity_litres`, `current_dip_litres` and
     * `dead_stock_litres`. A dip is not a setting — it is the reading a shift
     * reconciles against, and a rename that reset it would put a station's
     * whole night out by whatever was in the ground.
     */
    public function test_editing_forecourt_equipment_does_not_move_a_reading(): void
    {
        $this->openShop('petroleum');

        $petrol = $this->stockedProduct('Petrol');

        $tank = $this->create('/api/v1/fuel/tanks', [
            'name' => 'Tank 1', 'product_id' => $petrol,
            'capacity_litres' => 20000, 'current_dip_litres' => 12500,
            'dead_stock_litres' => 500,
        ]);
        $this->edit('a tank renamed', FuelTank::class, $tank,
            'put', "/api/v1/fuel/tanks/{$tank}", ['name' => 'Tank One']);

        $pump = $this->create('/api/v1/fuel/pumps', ['name' => 'Pump A', 'code' => 'PA']);
        $this->edit('a pump renamed', FuelPump::class, $pump,
            'put', "/api/v1/fuel/pumps/{$pump}", ['name' => 'Pump Alpha']);

        $this->assertGreaterThanOrEqual(2, $this->edits, 'the forecourt matrix shrank');
        $this->assertSame([], $this->wrong, "\n".implode("\n", $this->wrong)."\n");
    }

    /**
     * THE FLOOR. `PUT` and `PATCH /restaurant/tables/{id}` are both on the
     * untested list, and a table carries the seat count a floor plan is laid
     * out from.
     */
    public function test_editing_a_table_leaves_the_floor_plan_alone(): void
    {
        $this->openShop('food');

        $table = $this->create('/api/v1/restaurant/tables', [
            'name' => 'Table 4', 'area' => 'Terrace', 'seats' => 6, 'sort_order' => 2,
        ]);

        $this->edit('a table renamed', DiningTable::class, $table,
            'put', "/api/v1/restaurant/tables/{$table}", ['name' => 'Table Four']);

        $this->edit('a table moved in the list', DiningTable::class, $table,
            'patch', "/api/v1/restaurant/tables/{$table}", ['sort_order' => 5]);

        $this->assertGreaterThanOrEqual(2, $this->edits, 'the floor matrix shrank');
        $this->assertSame([], $this->wrong, "\n".implode("\n", $this->wrong)."\n");
    }

    /**
     * THE ADMIN CONSOLE, WHERE ONE EDIT REACHES EVERY SHOP ON THE PLATFORM.
     *
     * `PUT /admin/tenants`, `PUT /admin/plans` and the owner-password reset
     * under a tenant are three of the fifteen routes
     * nothing posts to, and `is_active` on a plan is one of the fields every
     * test supplies. A plan that switches itself off during an unrelated edit
     * takes every shop on it with it.
     *
     * The password reset is the one worth reading twice. It is the only write
     * on this list that touches a person's account, and the question is not
     * whether the password changed — it is whether anything ELSE did. A reset
     * that also reactivates a suspended owner, or clears a status somebody set
     * deliberately, hands back an account nobody meant to reopen.
     */
    public function test_an_admin_edit_reaches_only_what_it_named(): void
    {
        $admin = User::factory()->superAdmin()->create();
        $this->openShop('mart');
        $this->owner = $admin;

        // ── A plan, and the shops riding on it ──────────────────────
        $plan = $this->create('/api/v1/admin/plans', [
            'name' => 'Premium', 'code' => 'premium-'.uniqid(), 'price' => 3500,
            'billing_period_months' => 1, 'grace_period_days' => 7, 'is_active' => true,
        ]);
        $this->edit('a plan repriced', Plan::class, $plan,
            'put', "/api/v1/admin/plans/{$plan}", ['price' => 4999]);

        // ── A tenant's own record ───────────────────────────────────
        $this->edit('a shop recategorised', Tenant::class, $this->shop->id,
            'put', "/api/v1/admin/tenants/{$this->shop->id}", ['business_category' => 'grocery']);

        // ── A platform staffer ─────────────────────────────────────
        $staff = $this->create('/api/v1/admin/staff', [
            'name' => 'Ayesha', 'email' => 'ayesha-'.uniqid().'@cartze.test',
            'password' => 'a-long-enough-password',
            'permissions' => ['tenants.view'],
        ]);
        $this->edit('a platform staffer renamed', User::class, $staff,
            'put', "/api/v1/admin/staff/{$staff}", ['name' => 'Ayesha Khan']);

        // ── An announcement, and the audience it must keep ──────────
        //
        // The update goes over POST because it carries an image, which is the
        // detail that hid it: the scanner listed it as a write route nothing
        // posts to, and it does not LOOK like an edit.
        $note = $this->create('/api/v1/admin/announcements', [
            'title' => 'Scheduled downtime', 'body' => 'Sunday, 2am to 4am.',
            'audience' => 'tenants',
        ]);
        $this->edit('an announcement retitled', Announcement::class, $note,
            'post', "/api/v1/admin/announcements/{$note}", ['title' => 'Planned downtime']);

        // ── A banner, and the image it must not lose ────────────────
        $this->aBannerKeepsItsImageThroughARetitle();

        // ── The owner's password, and everything it must not touch ──
        $this->theOwnersPasswordResetTouchesNothingElse();

        $this->assertGreaterThanOrEqual(4, $this->edits, 'the admin matrix shrank');
        $this->assertSame([], $this->wrong, "\n".implode("\n", $this->wrong)."\n");
    }

    /**
     * A banner's image survives a retitle.
     *
     * The one case a column diff would have missed for the opposite reason to
     * the collection's: here the image IS a column, but creating the fixture
     * needs a real multipart upload, so it cannot ride the JSON helper the rest
     * of the matrix uses.
     *
     * It is worth the extra few lines. An update that goes over POST because it
     * carries a file is exactly where `$data['image'] ?? null` gets written,
     * and a banner that loses its artwork when somebody fixes a typo in the
     * title is a blank rectangle on the front of the marketplace.
     */
    private function aBannerKeepsItsImageThroughARetitle(): void
    {
        Storage::fake('public');

        $created = $this->as()->post('/api/v1/admin/banners', [
            'title' => 'Eid Sale',
            'placement' => 'home',
            'target_type' => 'none',
            'image' => UploadedFile::fake()->image('eid.jpg', 800, 400),
        ]);

        $this->assertSame(
            201,
            $created->status(),
            'the fixture banner was refused: '.json_encode($created->json('errors') ?? $created->json()),
        );

        $id = $created->json('data.id');
        $before = Banner::query()->findOrFail($id)->getAttributes();

        $res = $this->as()->post("/api/v1/admin/banners/{$id}", ['title' => 'Eid Offers']);
        $this->edits++;

        if ($res->status() >= 400) {
            $this->wrong[] = "a banner retitled: refused {$res->status()} for a one-field edit — "
                .json_encode($res->json('errors') ?? $res->json('meta'));

            return;
        }

        $after = Banner::query()->findOrFail($id)->getAttributes();

        foreach ($before as $field => $was) {
            if (in_array($field, self::THE_EDIT_ITSELF, true) || $field === 'title') {
                continue;
            }
            if (! $this->same($after[$field] ?? null, $was)) {
                $this->wrong[] = "a banner retitled: `{$field}` changed from ".var_export($was, true)
                    .' to '.var_export($after[$field] ?? null, true).' — nobody asked about it';
            }
        }
    }

    /**
     * A reset changes the password and the password only.
     *
     * Compared column by column with the hash excluded, because the hash is
     * the one thing that MUST move and bcrypt gives a different string for the
     * same word every time — asserting on it would be asserting on the salt.
     */
    private function theOwnersPasswordResetTouchesNothingElse(): void
    {
        /** @var User $shopOwner */
        $shopOwner = $this->rows(User::class)->where('tenant_id', $this->shop->id)->firstOrFail();
        $before = $shopOwner->getAttributes();

        $res = $this->as()->postJson("/api/v1/admin/tenants/{$this->shop->id}/owner-password", [
            'password' => 'a-new-long-password',
            'password_confirmation' => 'a-new-long-password',
        ]);

        if ($res->status() >= 400) {
            $this->wrong[] = "the owner's password reset: refused {$res->status()} — "
                .json_encode($res->json('errors') ?? $res->json('meta'));

            return;
        }

        $after = $this->rows(User::class)->whereKey($shopOwner->id)->firstOrFail()->getAttributes();

        if (($after['password'] ?? null) === ($before['password'] ?? null)) {
            $this->wrong[] = "the owner's password reset: answered {$res->status()} and the password did not change";
        }

        foreach ($before as $field => $was) {
            if (in_array($field, [...self::THE_EDIT_ITSELF, 'password', 'remember_token'], true)) {
                continue;
            }
            if (! $this->same($after[$field] ?? null, $was)) {
                $this->wrong[] = "the owner's password reset: `{$field}` changed from ".var_export($was, true)
                    .' to '.var_export($after[$field] ?? null, true).' — a reset is not a reinstatement';
            }
        }
    }

    /**
     * A collection's items are a RELATION, so no column comparison can see them.
     *
     * This is the case the scanner pointed at most directly — `item_ids` is
     * supplied by every test there is — and it is the one with the worst
     * outcome: a shop renames a collection from the catalog screen and the
     * marketplace aisle it feeds goes empty.
     */
    private function aCollectionKeepsItsItemsThroughARename(): void
    {
        $shirt = $this->stockedProduct('Shirt');
        $shoe = $this->stockedProduct('Shoe');

        $id = $this->create('/api/v1/collections', [
            'name' => 'Eid Picks', 'item_ids' => [$shirt, $shoe],
        ]);

        $before = ProductCollection::withoutTenancy()->findOrFail($id)->items()->count();
        $this->assertSame(2, $before, 'the fixture collection did not take its items');

        $this->edit('a collection renamed', ProductCollection::class, $id,
            'put', "/api/v1/collections/{$id}", ['name' => 'Eid Favourites']);

        $after = ProductCollection::withoutTenancy()->findOrFail($id)->items()->count();
        if ($after !== $before) {
            $this->wrong[] = "a collection renamed: it held {$before} items and now holds {$after} — "
                .'nobody asked about its contents';
        }
    }

    // ── The rule ────────────────────────────────────────────────────

    /**
     * Send one edit, and say what it did to everything else.
     *
     * @param  class-string<Model>  $model
     * @param  array<string, mixed>  $patch
     */
    private function edit(string $label, string $model, string $id, string $verb, string $url, array $patch): void
    {
        $this->edits++;

        /** @var Model $row */
        $row = $this->rows($model)->findOrFail($id);
        $before = $row->getAttributes();

        $res = $this->as()->{$verb.'Json'}($url, $patch);

        if ($res->status() >= 400) {
            // Not an error in the test — a finding. An endpoint that will not
            // change one field without the whole record back is how a screen
            // comes to send stale values over fresh ones.
            $this->wrong[] = "{$label}: refused {$res->status()} for a one-field edit — "
                .json_encode($res->json('errors') ?? $res->json('meta'));

            return;
        }

        $after = $this->rows($model)->findOrFail($id)->getAttributes();

        foreach ($patch as $field => $wanted) {
            if (! $this->same($after[$field] ?? null, $wanted)) {
                $this->wrong[] = "{$label}: answered {$res->status()} and `{$field}` is still "
                    .var_export($after[$field] ?? null, true);
            }
        }

        foreach ($before as $field => $was) {
            // `updated_at` is SUPPOSED to move, and so is `updated_by` — an
            // audit stamp recording who made this change is the one column
            // whose whole job is to move when somebody edits the row. Neither
            // says anything about what the shop will see on a screen.
            if (in_array($field, self::THE_EDIT_ITSELF, true) || array_key_exists($field, $patch)) {
                continue;
            }

            if (! $this->same($after[$field] ?? null, $was)) {
                $this->wrong[] = "{$label}: `{$field}` changed from ".var_export($was, true)
                    .' to '.var_export($after[$field] ?? null, true).' — nobody asked about it';
            }
        }
    }

    /**
     * Every row of a model, tenant scope and all.
     *
     * A shop's own models carry `BelongsToTenant` and need the scope lifted to
     * be read from a test; a Plan and a Tenant are platform records and have no
     * such scope to lift. Asking either one the wrong way is a fatal, not a
     * finding, so the question is asked once here.
     *
     * @param  class-string<Model>  $model
     * @return Builder<Model>
     */
    private function rows(string $model): Builder
    {
        return method_exists($model, 'withoutTenancy')
            ? $model::withoutTenancy()
            : $model::query();
    }

    /**
     * Equal enough to be the same value.
     *
     * A decimal column hands back `"12.00"` for the `12` that was sent, and a
     * boolean comes back as `1`. Comparing those strictly reports a defect on
     * every well-behaved endpoint, which is the fastest way to get a matrix
     * switched off.
     */
    private function same(mixed $a, mixed $b): bool
    {
        if ($a === null || $b === null) {
            return $a === $b;
        }
        if (is_numeric($a) && is_numeric($b)) {
            return abs((float) $a - (float) $b) < 0.0001;
        }
        if (is_bool($a) || is_bool($b)) {
            return (bool) $a === (bool) $b;
        }

        return (string) $a === (string) $b;
    }

    // ── Plumbing ────────────────────────────────────────────────────

    private function openShop(string $type): void
    {
        City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);

        $this->shop = Tenant::factory()->create([
            'business_type' => $type,
            // The matrix drives EVERY write endpoint, so it needs every module
            // its trade could have — a fixture on the trade defaults alone
            // could not reach a bank offer, which no trade starts with.
            'features' => Modules::normalize(array_merge(
                BusinessTypes::defaultFeatures($type),
                array_fill_keys(Modules::keys(), true),
            )),
            'setup_completed' => true,
            'timezone' => 'UTC',
            // Main counts as one, and the matrix opens a second.
            'limits' => ['branches' => 3],
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function as(): static
    {
        $this->defaultHeaders = [];
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param array<string, mixed> $payload */
    private function create(string $url, array $payload): string
    {
        $res = $this->as()->postJson($url, $payload);
        $this->assertSame(
            201,
            $res->status(),
            "the fixture POST {$url} answered {$res->status()}: ".json_encode($res->json('errors') ?? $res->json()),
        );

        return $res->json('data.id');
    }

    private function stockedProduct(string $name): string
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'name' => $name,
            'price' => 1000,
            'stock_quantity' => 10,
            'track_inventory' => true,
        ])->id;
    }
}
