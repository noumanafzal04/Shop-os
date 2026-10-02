<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * HOW LONG EVERY SCREEN TAKES WHEN THE SHOP IS REAL.
 *
 * The demo world is fifty products, and every endpoint is instant against
 * fifty products. These shops carry six thousand lines, twenty-three thousand
 * count rows and ninety-one closed shifts, which is where the two costs that
 * matter show up and nowhere else:
 *
 *   TIME     what the shopkeeper waits for.
 *   QUERIES  what tells you WHY. A screen that is slow because it runs one
 *            heavy query needs an index; a screen that is slow because it
 *            runs four hundred has an N+1, and no index will help it. The
 *            number separates those two without reading any code.
 *
 * Run from backend/ with the load-test world seeded:  php artisan loadtest:timings
 */
class TimeLoadTestScreens extends Command
{
    protected $signature = 'loadtest:timings
        {--shop=grocery : which load-test shop to measure}
        {--slow=400 : flag anything slower than this, in ms}
        {--queries=40 : flag anything that runs more than this many queries}';

    protected $description = 'Time the shop-side endpoints against a real-sized shop and count their queries';

    public function handle(): int
    {
        $tenant = Tenant::query()->where('slug', 'loadtest-'.$this->option('shop'))->first();

        if ($tenant === null) {
            $this->error('No such load-test shop. Run  php artisan loadtest:shops  first.');

            return self::FAILURE;
        }

        /** @var User $owner */
        $owner = User::query()->where('tenant_id', $tenant->id)->where('role', 'shop_owner')->firstOrFail();
        $token = $owner->createToken('timings', ['access'])->plainTextToken;

        $this->info("── {$tenant->business_name}");
        $this->line(sprintf('  %-46s %9s %8s', 'endpoint', 'ms', 'queries'));

        $slowMs = (float) $this->option('slow');
        $maxQueries = (int) $this->option('queries');
        $flagged = [];

        foreach ($this->endpoints() as $label => $uri) {
            [$ms, $queries, $status] = $this->time($uri, $token);

            $hot = $ms > $slowMs || $queries > $maxQueries || $status >= 400;
            $this->line(sprintf(
                '  %s %-46s %9s %8d%s',
                $hot ? '!' : ' ',
                $label,
                number_format($ms, 1),
                $queries,
                $status >= 400 ? "   HTTP {$status}" : '',
            ));

            if ($hot) {
                $flagged[] = sprintf('%s — %sms, %d queries%s', $label, number_format($ms, 1), $queries,
                    $status >= 400 ? " (HTTP {$status})" : '');
            }
        }

        $this->newLine();
        if ($flagged === []) {
            $this->info("Nothing over {$slowMs}ms or {$maxQueries} queries.");

            return self::SUCCESS;
        }

        $this->warn(count($flagged).' worth looking at:');
        foreach ($flagged as $line) {
            $this->line('  · '.$line);
        }

        return self::SUCCESS;
    }

    /**
     * The screens a shopkeeper opens, in the shape the panel asks for them.
     *
     * Page TWO is here on purpose beside page one: an offset scan costs
     * nothing at page one and everything at page two hundred, and the first
     * page is the only one most measurements ever look at.
     *
     * @return array<string, string>
     */
    private function endpoints(): array
    {
        $today = now()->toDateString();
        $from = now()->subDays(60)->toDateString();

        return [
            'dashboard' => '/api/v1/dashboard',
            'products · page 1' => '/api/v1/products?per_page=50',
            'products · page 20' => '/api/v1/products?per_page=50&page=20',
            'products · search' => '/api/v1/products?search=rice&per_page=50',
            // `/api/v1/inventory` does not exist — the stock list is the
            // MOVEMENTS feed, and five of this list's first URLs were my own
            // inventions returning 404 in 0.5ms. A path a measurement invents
            // is a measurement of nothing, and it reads as "very fast".
            'inventory · movements' => '/api/v1/inventory/movements?per_page=50',
            'inventory · low stock' => '/api/v1/inventory/low-stock',
            'inventory · expiring' => '/api/v1/inventory/expiring',
            'inventory · transfers' => '/api/v1/inventory/transfers',
            'customers · page 1' => '/api/v1/customers?per_page=50',
            'customers · search' => '/api/v1/customers?search=khan&per_page=50',
            'sales · page 1' => '/api/v1/sales?per_page=50',
            'sales · page 5' => '/api/v1/sales?per_page=50&page=5',
            'suppliers' => '/api/v1/suppliers',
            'purchase orders' => '/api/v1/purchase-orders?per_page=50',
            'expenses' => '/api/v1/expenses?per_page=50',
            'disposals' => '/api/v1/inventory/disposals',
            'stock counts' => '/api/v1/inventory/counts',
            'the till catalog' => '/api/v1/pos/catalog',
            'report · summary' => "/api/v1/reports/summary?period=custom&from={$from}&to={$today}",
            'report · margins' => "/api/v1/reports/margins?period=custom&from={$from}&to={$today}",
            'report · tax' => "/api/v1/reports/tax?period=custom&from={$from}&to={$today}",
            'report · purchases' => "/api/v1/reports/purchases?period=custom&from={$from}&to={$today}",
            'report · valuation' => '/api/v1/reports/valuation',
            'report · dead stock' => '/api/v1/reports/dead-stock',
            'report · staff' => "/api/v1/reports/staff?period=custom&from={$from}&to={$today}",
            'cashbook' => "/api/v1/cashbook?period=custom&from={$from}&to={$today}",
            'day & banking' => '/api/v1/pos/days?per_page=30',
        ];
    }

    /** @return array{0: float, 1: int, 2: int} */
    private function time(string $uri, string $token): array
    {
        $queries = 0;
        DB::flushQueryLog();
        DB::listen(function () use (&$queries): void {
            $queries++;
        });

        $request = Request::create($uri, 'GET');
        $request->headers->set('Authorization', 'Bearer '.$token);
        $request->headers->set('Accept', 'application/json');

        $started = microtime(true);
        $response = app()->handle($request);
        $ms = (microtime(true) - $started) * 1000;

        return [$ms, $queries, $response->getStatusCode()];
    }
}
