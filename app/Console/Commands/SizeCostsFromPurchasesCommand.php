<?php

namespace App\Console\Commands;

use App\Support\SizeCostsFromPurchases;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Mend the cost on size lines sold before sizes were costed — from purchase
 * receipts only. Says what it would do unless given --apply.
 */
class SizeCostsFromPurchasesCommand extends Command
{
    protected $signature = 'shopos:size-costs-from-purchases
        {--until= : The moment the size-cost fix went live (e.g. "2026-10-14 09:00"); later sales were costed right}
        {--tenant= : One shop\'s id; every shop when left out}
        {--apply : Write the changes; without it nothing is saved}';

    protected $description = 'Re-cost size lines sold before sizes were costed, from the purchase receipt of that size';

    public function handle(): int
    {
        if (! $this->option('until')) {
            $this->error('Say --until: the moment the size-cost fix went live. Sales after it were costed right and are not touched.');

            return self::INVALID;
        }

        $until = CarbonImmutable::parse((string) $this->option('until'));
        $apply = (bool) $this->option('apply');
        $done = SizeCostsFromPurchases::mend($until, $this->option('tenant') ?: null, $apply);

        foreach ($done['changes'] as $c) {
            $was = $c['was'] === null ? 'none' : number_format($c['was'], 2);
            $this->line("{$c['sale']} · {$c['size']} · {$was} → ".number_format($c['now'], 2)." (from {$c['from']})");
        }

        $this->info(sprintf(
            '%d size line(s) looked at: %d %s, %d already right, %d left as they were (no purchase receipt for that size), %d costed by recipe.',
            $done['looked_at'],
            $done['changed'],
            $apply ? 'changed' : 'would change',
            $done['already_right'],
            $done['no_record'],
            $done['cooked'],
        ));

        if (! $apply && $done['changed'] > 0) {
            $this->comment('Nothing was saved. Run again with --apply to write these.');
        }

        return self::SUCCESS;
    }
}
