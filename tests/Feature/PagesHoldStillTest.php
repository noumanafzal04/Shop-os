<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * A PAGED LIST SHOWS EVERY ROW ONCE.
 *
 * Found at volume: 2,000 products imported from one CSV, then read back a
 * page at a time. 1,989 came back. Eleven were on no page, and eleven others
 * were on two.
 *
 * The list is sorted by `created_at`, and every row of an import is created
 * in the same second. A sort on a column that ties leaves the database free
 * to order the ties as it likes — and to like something different for the
 * next page. So was nearly every other list in the product, by `sold_at`,
 * `placed_at`, `opened_at`.
 *
 * No test could see it: fixtures are made one at a time, a millisecond apart.
 */
class PagesHoldStillTest extends TestCase
{
    use RefreshDatabase;

    /**
     * The lists a shop opens every day, and the table each one pages.
     *
     * The ledger is last and different on purpose: it is five tables in a
     * union with no model behind it, so the key cannot be looked up and has to
     * be named. The first version of this fix forgot that and took the whole
     * books screen down with it.
     */
    private const LISTS = [
        '/api/v1/products' => 'products.id',
        '/api/v1/customers' => 'customers.id',
        '/api/v1/suppliers' => 'suppliers.id',
        '/api/v1/expenses' => 'expenses.id',
        '/api/v1/ledger' => 'id',
    ];

    public function test_the_page_a_shop_is_sent_is_cut_from_an_order_that_cannot_tie(): void
    {
        /*
         * Asked of the QUERY, not of the rows that came back.
         *
         * The obvious test — make 137 rows in one second, read fourteen pages,
         * count them — was written first and passed with the fix taken out.
         * A database that is free to order ties any way it likes is also free
         * to order them the same way twice, and on a small quiet table it
         * does. The rows only move when the table is big enough to be read
         * two different ways, which is to say in a shop and never in a test.
         *
         * So this reads what was actually asked for: the page is only safe if
         * the LAST thing it is sorted by is something no two rows share.
         */
        $this->withoutMiddleware(ThrottleRequests::class);
        $tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $owner = User::factory()->shopOwner($tenant)->create();
        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $as = function () use ($token) {
            $this->app['auth']->forgetGuards();

            return $this->withToken($token);
        };

        // A row in each, or there is no page to cut and no query to read.
        Product::query()->create([
            'tenant_id' => $tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'One', 'price' => 100, 'track_inventory' => false, 'is_active' => true,
        ]);
        $as()->postJson('/api/v1/customers', ['name' => 'Someone', 'phone' => '+923001112233'])->assertCreated();
        $as()->postJson('/api/v1/suppliers', ['name' => 'A Supplier'])->assertCreated();
        $category = $as()->postJson('/api/v1/expense-categories', ['name' => 'Rent'])->assertCreated()->json('data.id');
        $as()->postJson('/api/v1/expenses', [
            'expense_category_id' => $category, 'description' => 'Shop rent', 'amount' => 60000,
            'expense_date' => now()->toDateString(), 'payment_method' => 'cash',
        ])->assertCreated();

        $pages = [];
        DB::listen(function ($query) use (&$pages): void {
            if (preg_match('/^select .* limit \d+ offset \d+$/s', $query->sql)) {
                $pages[] = $query->sql;
            }
        });

        foreach (self::LISTS as $uri => $key) {
            $pages = [];
            $as()->getJson($uri.'?per_page=7')->assertOk();

            // THE DENOMINATOR. No page query seen means this asserted nothing.
            $this->assertNotSame([], $pages, "{$uri} ran no paged query, so nothing was checked");

            // Quotes differ by database and say nothing about the order.
            $sql = str_replace(['`', '"'], '', $pages[0]);
            $this->assertMatchesRegularExpression(
                '/order by (.*, )?'.preg_quote($key, '/').' (asc|desc) limit 7 offset 0$/s',
                $sql,
                "{$uri} is paged in an order that can tie — rows will be skipped and repeated: {$sql}",
            );
        }
    }

    public function test_no_list_is_paged_without_a_tiebreak(): void
    {
        /*
         * The rule, held where it can be read: `->stably()` is the step
         * immediately before every `->paginate()` — `->stably('id')` where
         * the query has no model to take a key from. A new list written without
         * it works perfectly in every test anybody will think to write, and
         * loses rows the first time a shop imports a catalogue.
         */
        $offenders = [];
        foreach (File::allFiles(app_path()) as $file) {
            foreach (explode("\n", $file->getContents()) as $n => $line) {
                if (preg_match('/->(paginate|simplePaginate)\(/', $line)
                    && ! preg_match('/->stably\((\'[a-z_.]+\')?\)->(paginate|simplePaginate)\(/', $line)) {
                    $offenders[] = str_replace(app_path().'/', '', $file->getPathname()).':'.($n + 1);
                }
            }
        }

        $this->assertSame([], $offenders, 'paged without ->stably() — rows will be skipped or repeated across pages');
    }

    public function test_the_tiebreak_is_the_last_word_and_not_the_first(): void
    {
        // The date a person asked for still sorts first; the key only breaks ties.
        $sql = Product::query()->orderByDesc('created_at')->stably()->toSql();

        $this->assertMatchesRegularExpression('/order by .*created_at.* desc, .*products.*id.* asc$/i', $sql);
        // …and it is not added twice, or over an order that already names the key.
        $this->assertSame(
            Product::query()->orderBy('id')->toSql(),
            Product::query()->orderBy('id')->stably()->toSql(),
        );
        // With no model there is no key to find, so it is named — once.
        $this->assertSame(
            'select * from ledger order by sort_at asc, id asc',
            str_replace(['`', '"'], '', DB::table('ledger')->orderBy('sort_at')->stably('id')->stably('id')->toSql()),
        );
        // A grouped query has no single row to break a tie with.
        $this->assertStringNotContainsString('order by', strtolower(Product::query()->groupBy('category_id')->stably()->toSql()));
    }
}
